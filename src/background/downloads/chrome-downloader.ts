/**
 * Chrome 内置下载执行器
 *
 * - startDirectDownload: Layer 1-4 多层级降级链（直下 → offscreen → 页面 fetch → save-helper）
 * - startHlsDownload: HLS 专用下载器包装（非阻塞）
 * - monitorChromeDownload: chrome.downloads 进度/状态监控
 * - onDeterminingFilename 文件名安全网
 */

import type { DownloadTask } from '../../types'
import { downloadHls } from '../hls-downloader'
import { fetchAndDownload } from '../../utils/offscreen-blob'
import {
  getTask,
  getActiveEntry,
  setActiveEntry,
  deleteActiveEntry,
  hasActiveEntry,
  updateTaskStatus,
  updateTaskProgress,
  updateTaskChromeDownloadId,
  completeDownloadTask,
  persistTasks,
  requestQueueDrain,
} from './task-store'
import { buildDownloadFileName, getExtensionFromFormat, getMimeTypeFromFormat } from './naming'
import { setupDownloadRules } from './dnr-rules'

// chromeDownloadId → intended filename 映射（onDeterminingFilename 安全网）
const chromeDownloadFilenames = new Map<number, string>()

// ===== onDeterminingFilename 安全网 =====
// 当 declarativeNetRequest 的 Content-Disposition 移除规则未生效时，
// 通过此回调强制使用我们指定的文件名
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    const intended = chromeDownloadFilenames.get(downloadItem.id)
    if (intended) {
      suggest({ filename: intended, conflictAction: 'uniquify' })
      chromeDownloadFilenames.delete(downloadItem.id)
    } else {
      suggest() // 保持默认
    }
  })
}

// ===== 非 HLS：多层级降级链 =====

export async function startDirectDownload(task: DownloadTask, settings: any): Promise<void> {
  // 设置 Referer 和移除 Content-Disposition
  await setupDownloadRules(task)

  // 尝试构建文件名
  const video = task.video
  const ext = getExtensionFromFormat(video.format)
  const fileName = buildDownloadFileName(video.title, ext)

  // Layer 1: 直接 chrome.downloads.download
  try {
    const downloadId = await chrome.downloads.download({
      url: video.url,
      filename: settings.baseSaveDirectory
        ? `${settings.baseSaveDirectory}/${fileName}`
        : fileName,
      saveAs: settings.downloadSettings?.askSaveLocation || false,
      conflictAction: 'uniquify',
    })

    if (downloadId) {
      setActiveEntry(task.id, { chromeDownloadId: downloadId, filename: fileName })
      // 注册 onDeterminingFilename 安全网
      chromeDownloadFilenames.set(downloadId, fileName)
      await monitorChromeDownload(task, downloadId)
      return // 成功，正常返回
    }
  } catch (error: any) {
    console.warn('[DownloadManager] Layer 1 chrome.downloads failed:', error.message)
  }

  // Layer 2: Offscreen Document fetch → save-helper
  try {
    await downloadViaOffscreen(task)
    return
  } catch (error: any) {
    console.warn('[DownloadManager] Layer 2 offscreen failed:', error.message)
  }

  // Layer 3: 页面 MAIN world fetch
  try {
    await downloadViaPageFetch(task)
    return
  } catch (error: any) {
    console.warn('[DownloadManager] Layer 3 page fetch failed:', error.message)
  }

  // Layer 4: save-helper 直接 fetch
  try {
    await downloadViaSaveHelper(task)
    return
  } catch (error: any) {
    console.error('[DownloadManager] Layer 4 save-helper failed:', error.message)
    deleteActiveEntry(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
  }
}

// ===== 监控 chrome.downloads 进度 =====

async function monitorChromeDownload(task: DownloadTask, downloadId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      if (!hasActiveEntry(task.id)) {
        clearInterval(interval)
        resolve()
        return
      }

      try {
        const results = await chrome.downloads.search({ id: downloadId })
        if (results.length > 0) {
          const dl = results[0]
          const progress = dl.totalBytes > 0 ? (dl.bytesReceived / dl.totalBytes) * 100 : 0
          updateTaskProgress(task.id, progress, 0, dl.bytesReceived, dl.totalBytes)
        }
      } catch {
        clearInterval(interval)
        resolve()
      }
    }, 1000)

    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return

      if (delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener)
        clearInterval(interval)
        deleteActiveEntry(task.id)
        updateTaskStatus(task.id, 'completed')
        requestQueueDrain()
        resolve()
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener)
        clearInterval(interval)
        deleteActiveEntry(task.id)
        updateTaskStatus(task.id, 'failed', delta.error?.current || '下载中断')
        requestQueueDrain()
        resolve()
      }
    }

    chrome.downloads.onChanged.addListener(listener)

    // 30 分钟超时
    setTimeout(() => {
      clearInterval(interval)
      chrome.downloads.onChanged.removeListener(listener)
      if (hasActiveEntry(task.id)) {
        deleteActiveEntry(task.id)
        updateTaskStatus(task.id, 'failed', '下载超时')
        requestQueueDrain()
        resolve()
      }
    }, 30 * 60 * 1000)
  })
}

// ===== Layer 2: Offscreen Document fetch =====

async function downloadViaOffscreen(task: DownloadTask): Promise<void> {
  const fileName = buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format))
  const mimeType = getMimeTypeFromFormat(task.video.format)

  // offscreen document 内 fetch → File → blob URL → chrome.downloads
  // (协议见 assets/offscreen.js 的 OFFSCREEN_FETCH_AND_DOWNLOAD handler)
  const result = await fetchAndDownload({
    url: task.video.url,
    referer: task.video.pageUrl || task.video.url,
    mimeType,
    taskId: task.id,
    filename: fileName,
    saveAs: false,
  })

  if (result.downloadId) {
    await updateTaskChromeDownloadId(task.id, result.downloadId)
    await completeDownloadTask(task.id, result.downloadId)
    return
  }

  // 数据已下载但 chrome.downloads 保存失败：offscreen 已把数据写入 IndexedDB，
  // 打开 save-helper 页面按 key 取回并保存（与 HLS 保存降级同一协议）
  if (result.fallbackKey) {
    const helperUrl = chrome.runtime.getURL(
      `save-helper.html?k=${encodeURIComponent(result.fallbackKey)}&n=${encodeURIComponent(fileName)}&m=${encodeURIComponent(mimeType)}&s=0&t=${encodeURIComponent(task.id)}`
    )
    await chrome.tabs.create({ url: helperUrl, active: true })
    await waitForTaskCompletion(task.id, 120000)
    return
  }

  throw new Error('Offscreen 下载失败')
}

// ===== Layer 3: 页面 MAIN world fetch =====

async function downloadViaPageFetch(task: DownloadTask): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('无活动标签页')

  // 无接收方或接收方不响应时 sendMessage 返回 undefined——立即失败，
  // 避免后面 waitForTaskCompletion 白等 2 分钟
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'PAGE_FETCH_DOWNLOAD',
    payload: {
      url: task.video.url,
      taskId: task.id,
      fileName: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)),
    },
  })
  if (response === undefined) {
    throw new Error('页面无下载接收方')
  }

  // 等待完成或超时
  await waitForTaskCompletion(task.id, 120000)
}

// ===== Layer 4: save-helper 直接 fetch =====

async function downloadViaSaveHelper(task: DownloadTask): Promise<void> {
  // save-helper 未打开时不响应——立即失败，避免 waitForTaskCompletion 白等 2 分钟
  const response = await chrome.runtime.sendMessage({
    type: 'SAVE_HELPER_FETCH_DOWNLOAD',
    payload: {
      url: task.video.url,
      fileName: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)),
      taskId: task.id,
    },
  })
  if (response === undefined) {
    throw new Error('save-helper 未就绪')
  }

  await waitForTaskCompletion(task.id, 120000)
}

// ===== HLS 下载 (非阻塞) =====

export async function startHlsDownload(task: DownloadTask, concurrency: number): Promise<void> {
  // processQueue 已经设置过 'downloading'，这里不再重复
  const abortController = new AbortController()
  const existing = getActiveEntry(task.id)
  setActiveEntry(task.id, { ...existing, abortController, isHls: true })

  try {
    const result = await downloadHls(
      task,
      abortController.signal,
      concurrency,
      (progress, speed, downloadedBytes) => {
        // 更新队列中的 task 对象，然后保存整个队列
        task.progress = progress
        task.speed = speed
        task.downloadedBytes = downloadedBytes
        persistTasks()
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          payload: task,
        }).catch(() => {})
      },
      (status, error) => {
        if (status === 'completed') {
          // 保存成功，由下面的 result 检查处理
          return
        }
        updateTaskStatus(task.id, status, error)
      }
    )
    if (result?.chromeDownloadId) {
      const entry = getActiveEntry(task.id)
      if (entry) entry.chromeDownloadId = result.chromeDownloadId
    }
    if (result?.savedFileName) {
      updateTaskStatus(task.id, 'completed')
    }
  } catch (error: any) {
    if (abortController.signal.aborted) {
      updateTaskStatus(task.id, 'paused')
    } else {
      updateTaskStatus(task.id, 'failed', error.message)
    }
  } finally {
    deleteActiveEntry(task.id)
    // HLS 完成后触发队列继续处理（可能有新任务进入）
    requestQueueDrain()
  }
}

// ===== 跨上下文完成等待 =====

// 等待跨上下文下载（save-helper / 页面 fetch）完成：
// 完成→resolve；失败/超时→reject（让上层降级链继续尝试下一层）
function waitForTaskCompletion(taskId: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let check: ReturnType<typeof setInterval> | undefined
    const finish = (fn: () => void) => {
      if (check) clearInterval(check)
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => reject(new Error('等待下载完成超时')))
    }, timeout)
    check = setInterval(() => {
      const task = getTask(taskId)
      if (!task) {
        finish(() => resolve())
      } else if (task.status === 'completed') {
        finish(() => resolve())
      } else if (task.status === 'failed') {
        finish(() => reject(new Error(task.error || '下载失败')))
      }
    }, 1000)
  })
}
