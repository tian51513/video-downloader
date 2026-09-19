import type {
  DetectedVideo,
  DownloadTask,
  DownloadSettings,
  DownloaderType,
} from '../types'
import { saveDownloads, getDownloads, getSettings as getFullSettings } from '../utils/storage'
import { downloadHls } from './hls-downloader'
import { fetchAndDownload } from '../utils/offscreen-blob'

let activeDownloads: Map<string, { abortController?: AbortController; chromeDownloadId?: number; filename?: string; isHls?: boolean }> = new Map()
let downloadQueue: DownloadTask[] = []
let isProcessing = false
// chromeDownloadId → intended filename 映射（onDeterminingFilename 安全网）
let chromeDownloadFilenames: Map<number, string> = new Map()

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

// ===== 导出函数 =====

export async function createDownloadTask(
  video: DetectedVideo,
  downloader: DownloaderType
): Promise<DownloadTask> {
  // URL 级去重（失败任务除外——允许重试重建；状态机里没有 'cancelled'，取消即 failed）
  const existing = downloadQueue.find((t) => t.video.url === video.url && t.status !== 'failed')
  if (existing) return existing

  const settings = await getFullSettings()

  // 从页面获取最新标题
  const title = await refreshTitleFromPage(video)

  const task: DownloadTask = {
    id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    video: { ...video, title: title || video.title },
    status: 'pending',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: video.size || 0,
    downloader,
  }

  downloadQueue.push(task)
  await persistTasks()
  broadcastDownloadUpdate(task)
  processQueue()

  return task
}

export async function retryDownload(taskId: string): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task || (task.status !== 'failed' && task.status !== 'paused')) return

  task.status = 'pending'
  task.progress = 0
  task.speed = 0
  task.downloadedBytes = 0
  task.error = undefined
  task.startedAt = undefined
  task.completedAt = undefined

  await persistTasks()
  broadcastDownloadUpdate(task)
  processQueue()
}

export async function pauseDownload(taskId: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
    activeDownloads.delete(taskId)
  }

  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.status = 'paused'
    await persistTasks()
    broadcastDownloadUpdate(task)
  }
}

export async function cancelDownload(taskId: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
  }
  activeDownloads.delete(taskId)

  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.status = 'failed'
    task.error = '已取消'
    await persistTasks()
    broadcastDownloadUpdate(task)
  }
}

export async function updateTaskChromeDownloadId(
  taskId: string,
  chromeDownloadId: number
): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.chromeDownloadId = chromeDownloadId
    const entry = activeDownloads.get(taskId)
    if (entry) entry.chromeDownloadId = chromeDownloadId
  }
}

export async function clearCompletedDownloads(): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.status !== 'completed' && t.status !== 'failed')
  await persistTasks()
}

export async function clearCompletedFullDownloads(): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.status !== 'completed')
  await persistTasks()
}

export async function clearFailedDownloads(): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.status !== 'failed')
  await persistTasks()
}

export async function clearOrphanedDownloads(openPageUrls: string[]): Promise<void> {
  const urlSet = new Set(openPageUrls)
  downloadQueue = downloadQueue.filter((t) => {
    const pageUrl = t.video.pageUrl
    if (!pageUrl) return true
    return urlSet.has(pageUrl)
  })
  await persistTasks()
}

export async function clearPageDownloads(pageUrl: string): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.video.pageUrl !== pageUrl)
  await persistTasks()
}

export async function removeDownloadTask(taskId: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
  }
  activeDownloads.delete(taskId)
  downloadQueue = downloadQueue.filter((t) => t.id !== taskId)
  await persistTasks()
}

export async function getAllDownloadTasks(): Promise<DownloadTask[]> {
  downloadQueue = await getDownloads()
  return downloadQueue
}

export async function completeDownloadTask(
  taskId: string,
  chromeDownloadId?: number
): Promise<void> {
  activeDownloads.delete(taskId)

  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.status = 'completed'
  task.completedAt = Date.now()
  if (chromeDownloadId) task.chromeDownloadId = chromeDownloadId

  await persistTasks()
  broadcastDownloadUpdate(task)
}

// 页面/offscreen/save-helper 多来源上报进度，可能乱序或字段缺失：
// - 只接受有限数值，忽略 undefined/NaN（防止把任务进度抹成 undefined）
// - progress 单调递增，不允许回退
export async function updateTaskProgressFromPage(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number,
  totalBytes?: number
): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  if (Number.isFinite(progress) && progress > (task.progress ?? 0)) {
    task.progress = progress
  }
  if (Number.isFinite(speed)) task.speed = speed
  if (Number.isFinite(downloadedBytes)) task.downloadedBytes = downloadedBytes
  if (Number.isFinite(totalBytes) && totalBytes > 0) task.totalBytes = totalBytes

  broadcastDownloadUpdate(task)
}

// 从页面/辅助页报告失败：中止活动下载并把任务置为 failed（区别于 cancelDownload 的"已取消"）
export async function failDownloadTask(taskId: string, error?: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
  }
  activeDownloads.delete(taskId)
  updateTaskStatus(taskId, 'failed', error || '下载失败')
}

// ===== 从页面获取最新标题 =====

async function refreshTitleFromPage(video: DetectedVideo): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) return video.title

    // 只对同页面视频刷新标题
    const videoPageUrl = video.pageUrl || ''
    if (tab.url !== videoPageUrl) return video.title

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const title = document.title?.trim() || ''
        const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || ''
        const h1 = document.querySelector('h1')?.textContent?.trim() || ''
        return title || og || h1 || ''
      },
    })

    const pageName = results?.[0]?.result
    if (pageName && pageName.length > 0 && pageName.length < 200) return pageName
  } catch { /* ignore */ }
  return video.title
}

// ===== 队列处理 =====

export async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  try {
    while (true) {
      const settings = await getFullSettings()
      const { maxConcurrent } = settings.downloadSettings

      // HLS 下载占槽位（SW 实际执行下载），chrome.downloads 不占（浏览器自己下载）
      const hlsActiveCount = Array.from(activeDownloads.values()).filter((e) => e.isHls).length

      // 优先处理非 HLS 任务（fire-and-forget，不占槽位），再处理 HLS 任务
      let next = downloadQueue.find((t) => t.status === 'pending' && t.video.format !== 'hls')
      if (!next && hlsActiveCount < maxConcurrent) {
        next = downloadQueue.find((t) => t.status === 'pending')
      }
      if (!next) break

      const isHls = next.video.format === 'hls'
      updateTaskStatus(next.id, 'downloading')

      // 统一 fire-and-forget：HLS 占并发槽（见上方 hlsActiveCount 判定），
      // chrome.downloads / aria2 / idm 由浏览器或外部程序执行，不阻塞队列
      activeDownloads.set(next.id, { isHls })
      downloadWithChrome(next, settings).catch((error: any) => {
        activeDownloads.delete(next.id)
        updateTaskStatus(next.id, 'failed', error.message)
      })
    }
  } finally {
    isProcessing = false
  }
}

// ===== Chrome 多层级降级下载 =====

async function downloadWithChrome(task: DownloadTask, settings: any): Promise<void> {
  // 外部下载器分发（aria2/motrix 走 JSON-RPC，idm 走协议跳转；
  // chrome 内置下载的 HLS/多层级降级分支见下）
  if (task.downloader === 'aria2' || task.downloader === 'motrix') {
    return downloadWithAria2(task, settings)
  }
  if (task.downloader === 'idm') {
    return downloadWithIDM(task)
  }

  const video = task.video
  const isHls = video.format === 'hls'

  // HLS 走专用下载器
  if (isHls) {
    return downloadHLS(task, settings.downloadSettings.maxConcurrent || 3)
  }

  // 设置 Referer 和移除 Content-Disposition
  await setupDownloadRules(task)

  // 尝试构建文件名
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
      activeDownloads.set(task.id, { chromeDownloadId: downloadId, filename: fileName })
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
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
  }
}

// ===== 设置 Referer 和移除 Content-Disposition =====

export async function setupDownloadRules(task: DownloadTask): Promise<void> {
  // DNR 无法拦截 blob:/data: 等 URL，且其 origin 为 "null"，生成的规则是无效规则
  if (!task.video.url.startsWith('http')) {
    return
  }
  const urlObj = new URL(task.video.url)
  const domain = urlObj.hostname
  const pageDomain = task.video.pageUrl ? new URL(task.video.pageUrl).hostname : domain

  try {
    // 添加 Referer（rule ID 必须是正整数）
    const ruleId = Math.abs(hashCode(task.id)) % 2147483647 || 1
    await chrome.declarativeNetRequest.updateSessionRules({
      // 当前 @types/chrome 的 DNR 枚举落后于 Chrome 实际支持的 action/operation/resourceTypes，整体放宽
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: task.video.pageUrl || task.video.url },
          ],
          responseHeaders: [
            { header: 'Content-Disposition', operation: 'remove' },
          ],
        },
        condition: {
          urlFilter: `||${urlObj.origin}`,
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'],
        },
      }] as any,
      removeRuleIds: [ruleId],
    })
  } catch (error) {
    console.warn('[DownloadManager] Failed to set download rules:', error)
  }
}

// ===== 监控 chrome.downloads 进度 =====

async function monitorChromeDownload(task: DownloadTask, downloadId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      if (!activeDownloads.has(task.id)) {
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
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'completed')
        processQueue()
        resolve()
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener)
        clearInterval(interval)
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'failed', delta.error?.current || '下载中断')
        processQueue()
        resolve()
      }
    }

    chrome.downloads.onChanged.addListener(listener)

    // 30 分钟超时
    setTimeout(() => {
      clearInterval(interval)
      chrome.downloads.onChanged.removeListener(listener)
      if (activeDownloads.has(task.id)) {
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'failed', '下载超时')
        processQueue()
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

async function downloadHLS(task: DownloadTask, concurrency: number): Promise<void> {
  // processQueue 已经设置过 'downloading'，这里不再重复
  const abortController = new AbortController()
  const existing = activeDownloads.get(task.id)
  activeDownloads.set(task.id, { ...existing, abortController, isHls: true })

  try {
    const result = await downloadHls(
      task,
      abortController.signal,
      concurrency,
      (progress, speed, downloadedBytes) => {
        // 更新 downloadQueue 中的 task 对象，然后保存整个队列
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
      const entry = activeDownloads.get(task.id)
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
    activeDownloads.delete(task.id)
    // HLS 完成后触发队列继续处理（可能有新任务进入）
    processQueue()
  }
}

// ===== aria2 / IDM 下载 =====

async function downloadWithAria2(task: DownloadTask, settings: any): Promise<void> {
  const config = settings.externalDownloaderConfig

  try {
    const response = await fetch(config.aria2RpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: task.id,
        method: 'aria2.addUri',
        params: [
          [task.video.url],
          {
            dir: settings.baseSaveDirectory || undefined,
            out: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)),
            header: task.video.pageUrl ? [`Referer: ${task.video.pageUrl}`] : undefined,
          },
        ],
      }),
    })

    const result = await response.json()
    if (result.error) {
      throw new Error(result.error.message)
    }

    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'completed')
    processQueue()
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

async function downloadWithIDM(task: DownloadTask): Promise<void> {
  try {
    const idmUrl = `idm://${encodeURIComponent(task.video.url)}`
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: idmUrl })
    }
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'completed')
    processQueue()
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

// ===== 辅助函数 =====

function getMimeTypeFromFormat(format: string): string {
  const audioMime: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
  }
  if (audioMime[format]) return audioMime[format]
  if (format === 'ts') return 'video/mp2t'
  return `video/${format}`
}

function getExtensionFromFormat(format: string): string {
  const map: Record<string, string> = {
    mp4: '.mp4', mkv: '.mkv', webm: '.webm', flv: '.flv', avi: '.avi',
    mov: '.mov', ts: '.ts', blob: '.mp4',
    mp3: '.mp3', m4a: '.m4a', aac: '.aac', flac: '.flac',
    ogg: '.ogg', wav: '.wav', wma: '.wma', opus: '.opus',
  }
  return map[format] || '.mp4'
}

export function buildDownloadFileName(title: string, ext: string): string {
  const settings = getNamingTemplateSync()
  const vars: Record<string, string> = {
    name: (title || 'download').replace(/\.[^.]+$/, ''),
    format: ext.replace('.', ''),
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toISOString().slice(11, 19).replace(/:/g, '-'),
    domain: '',
  }

  let fileName = settings
  for (const [key, value] of Object.entries(vars)) {
    fileName = fileName.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }

  // 清理文件名
  fileName = fileName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .substring(0, 200)

  // 如果文件名已包含扩展名，不再重复添加
  const extWithDot = ext.startsWith('.') ? ext : `.${ext}`
  if (fileName.endsWith(extWithDot)) return fileName
  return `${fileName}${ext}`
}

let cachedNamingTemplate = '{name}.{format}'
function getNamingTemplateSync(): string {
  return cachedNamingTemplate
}

// 定期刷新命名模板
setInterval(async () => {
  try {
    const settings = await getFullSettings()
    cachedNamingTemplate = settings.namingTemplate || '{name}.{format}'
  } catch { /* ignore */ }
}, 10000)

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
      const task = downloadQueue.find((t) => t.id === taskId)
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

// ===== 状态更新 =====

function updateTaskStatus(
  taskId: string,
  status: DownloadTask['status'],
  error?: string
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.status = status
  if (error) task.error = error
  if (status === 'completed' || status === 'failed') {
    task.completedAt = Date.now()
  }

  broadcastDownloadUpdate(task)
  persistTasks()
}

function updateTaskProgress(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number,
  totalBytes?: number
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.progress = progress
  task.speed = speed
  task.downloadedBytes = downloadedBytes
  if (totalBytes !== undefined && totalBytes > 0) task.totalBytes = totalBytes

  broadcastDownloadUpdate(task)
}

function broadcastDownloadUpdate(task: DownloadTask): void {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    payload: task,
  }).catch(() => {})
}

async function persistTasks(): Promise<void> {
  await saveDownloads(downloadQueue)
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return hash
}
