import type {
  DetectedVideo,
  DownloadTask,
  DownloadSettings,
  DownloaderType,
} from '../types'
import { getFullSettings } from './settings'
import { saveDownloads, getDownloads } from '../utils/storage'
import { downloadHls } from './hls-downloader'

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
  // URL 级去重
  const existing = downloadQueue.find((t) => t.video.url === video.url && t.status !== 'failed' && t.status !== 'cancelled')
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

export async function updateTaskProgressFromPage(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number,
  totalBytes?: number
): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.progress = progress
  task.speed = speed
  task.downloadedBytes = downloadedBytes
  if (totalBytes !== undefined && totalBytes > 0) task.totalBytes = totalBytes

  broadcastDownloadUpdate(task)
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

async function processQueue(): Promise<void> {
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

      if (isHls) {
        // HLS 下载：await 占用槽位
        activeDownloads.set(next.id, { isHls: true })
        try {
          await downloadWithChrome(next, settings)
        } catch (error: any) {
          activeDownloads.delete(next.id)
          updateTaskStatus(next.id, 'failed', error.message)
        }
      } else {
        // chrome.downloads / aria2 / idm：fire-and-forget，不阻塞队列
        activeDownloads.set(next.id, { isHls: false })
        downloadWithChrome(next, settings).catch((error: any) => {
          activeDownloads.delete(next.id)
          updateTaskStatus(next.id, 'failed', error.message)
        })
        // 立即继续处理下一个 pending 任务（不 await）
      }
    }
  } finally {
    isProcessing = false
  }
}

// ===== Chrome 多层级降级下载 =====

async function downloadWithChrome(task: DownloadTask, settings: any): Promise<void> {
  const video = task.video
  const isHls = video.format === 'hls'

  // HLS 走专用下载器
  if (isHls) {
    return downloadHLS(task)
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

async function setupDownloadRules(task: DownloadTask): Promise<void> {
  const urlObj = new URL(task.video.url)
  const domain = urlObj.hostname
  const pageDomain = task.video.pageUrl ? new URL(task.video.pageUrl).hostname : domain

  try {
    // 添加 Referer（rule ID 必须是正整数）
    const ruleId = Math.abs(hashCode(task.id)) % 2147483647 || 1
    await chrome.declarativeNetRequest.updateSessionRules({
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
      }],
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
  const blobUrl = await createOffscreenBlob(task.video.url)

  // 在 offscreen 中通过 save-helper 保存
  await chrome.runtime.sendMessage({
    type: 'SAVE_HELPER_DOWNLOAD',
    payload: { url: blobUrl, fileName: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)), taskId: task.id },
  })

  activeDownloads.delete(task.id)
  updateTaskStatus(task.id, 'completed')
}

// ===== Layer 3: 页面 MAIN world fetch =====

async function downloadViaPageFetch(task: DownloadTask): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('无活动标签页')

  await chrome.tabs.sendMessage(tab.id, {
    type: 'PAGE_FETCH_DOWNLOAD',
    payload: {
      url: task.video.url,
      taskId: task.id,
      fileName: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)),
    },
  })

  // 等待完成或超时
  await waitForTaskCompletion(task.id, 120000)
}

// ===== Layer 4: save-helper 直接 fetch =====

async function downloadViaSaveHelper(task: DownloadTask): Promise<void> {
  await chrome.runtime.sendMessage({
    type: 'SAVE_HELPER_FETCH_DOWNLOAD',
    payload: {
      url: task.video.url,
      fileName: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)),
      taskId: task.id,
    },
  })

  await waitForTaskCompletion(task.id, 120000)
}

// ===== HLS 下载 (非阻塞) =====

async function downloadHLS(task: DownloadTask): Promise<void> {
  // processQueue 已经设置过 'downloading'，这里不再重复
  const abortController = new AbortController()
  const existing = activeDownloads.get(task.id)
  activeDownloads.set(task.id, { ...existing, abortController, isHls: true })

  try {
    const result = await downloadHls(
      task,
      abortController.signal,
      (progress, speed, downloadedBytes) => {
        // 广播进度到 UI
        const updated = { ...task, progress, speed, downloadedBytes }
        saveDownloads([updated])
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          payload: updated,
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

function getExtensionFromFormat(format: string): string {
  const map: Record<string, string> = {
    mp4: '.mp4', mkv: '.mkv', webm: '.webm', flv: '.flv', avi: '.avi',
    mov: '.mov', ts: '.ts', blob: '.mp4',
    mp3: '.mp3', m4a: '.m4a', aac: '.aac', flac: '.flac',
    ogg: '.ogg', wav: '.wav', wma: '.wma', opus: '.opus',
  }
  return map[format] || '.mp4'
}

function buildDownloadFileName(title: string, ext: string): string {
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

async function createOffscreenBlob(url: string): Promise<string> {
  // 创建 offscreen document
  await chrome.offscreen.hasDocument().then(async (hasDoc) => {
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('assets/offscreen.html'),
        reasons: ['BLOB'] as any,
      })
    }
  })

  // 在 offscreen 中创建 blob URL
  const response = await chrome.runtime.sendMessage({
    type: 'CREATE_OFFSCREEN_BLOB',
    payload: { url },
  })

  if (!response?.blobUrl) throw new Error('创建 Blob URL 失败')
  return response.blobUrl
}

function waitForTaskCompletion(taskId: string, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const task = downloadQueue.find((t) => t.id === taskId)
      if (!task || task.status === 'completed' || task.status === 'failed') {
        clearInterval(check)
        resolve()
      }
    }, 1000)

    setTimeout(() => {
      clearInterval(check)
      resolve()
    }, timeout)
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
