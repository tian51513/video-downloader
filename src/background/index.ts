import { initDefaultSettings, getFullSettings, patchSettings, resetToDefaults } from './settings'
import {
  createDownloadTask,
  pauseDownload,
  cancelDownload,
  retryDownload,
  getAllDownloadTasks,
  updateTaskChromeDownloadId,
  updateTaskProgressFromPage,
  completeDownloadTask,
  clearCompletedDownloads,
  clearCompletedFullDownloads,
  clearFailedDownloads,
  clearOrphanedDownloads,
  clearPageDownloads,
  removeDownloadTask,
} from './download-manager'
import type { DetectedVideo, ExtensionMessage } from '../types'
import { saveVideos, getVideos, clearVideos, getAllVideos, clearAllVideos, clearOrphanedVideos, removeVideosByUrls } from '../utils/storage'
import { injectorMain } from '../utils/injector-script'

const pageVideos = new Map<string, DetectedVideo[]>()

// ===== MAIN world 注入脚本字符串 =====
// 注入时不能引用外部模块，需要将整个函数体作为字符串传递
function getInjectorScriptSource(): string {
  return '(' + injectorMain.toString() + ')()'
}

// ===== 注入 MAIN world 脚本到指定 tab =====
async function injectMainWorldScript(tabId: number, allFrames?: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: !!allFrames },
      world: 'MAIN',
      func: injectorMain,
    })
  } catch (error: any) {
    // chrome:// pages 等受限页面无法注入，忽略
    if (!error.message?.includes('Cannot access') && !error.message?.includes('is not allowed')) {
      console.warn('[VideoDownloader] Failed to inject MAIN world script:', error.message)
    }
  }
}

// ===== 注入到所有已打开的 tab =====
async function injectToAllTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        await injectMainWorldScript(tab.id, true)
      }
    }
  } catch (error: any) {
    console.warn('[VideoDownloader] Failed to inject to all tabs:', error.message)
  }
}

// ===== 扩展安装/更新 =====
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[VideoDownloader] Extension installed')
  await initDefaultSettings()
  setupContextMenus()
  // 注入到所有已打开的标签页
  await injectToAllTabs()
})

// ===== Tab 导航时重新注入 =====
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return

  if (changeInfo.status === 'loading') {
    // loading 阶段立即注入（建立 Fetch/XHR/Blob hooks）
    injectMainWorldScript(tabId, true).catch(() => {})
  } else if (changeInfo.status === 'complete') {
    // complete 阶段再次注入（确保 DOM 完全加载后扫描）
    injectMainWorldScript(tabId, true).catch(() => {})
  }
})

// ===== Tab 切换时更新全局 badge =====
chrome.tabs.onActivated.addListener(() => {
  updateGlobalBadge()
})

// ===== 全局 badge（按标题去重后的总数）=====
async function updateGlobalBadge(): Promise<void> {
  const stored = await getAllVideos()
  const storedMap = new Map<string, any[]>()
  for (const video of stored) {
    const pUrl = video.pageUrl || ''
    if (!storedMap.has(pUrl)) storedMap.set(pUrl, [])
    storedMap.get(pUrl)!.push(video)
  }
  // 内存缓存优先（覆盖 storage 中同页面的旧数据）
  for (const [pUrl, videos] of pageVideos) {
    storedMap.set(pUrl, videos)
  }
  const all = Array.from(storedMap.values()).flat()
  const uniqueTitles = new Set<string>()
  for (const v of all) {
    const title = v.title?.trim()
    if (title) uniqueTitles.add(title)
  }
  const count = uniqueTitles.size
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' })
  chrome.action.setBadgeBackgroundColor({ color: '#1677ff' })
}

// ===== Keepalive alarm (防止 Service Worker 被终止) =====
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // 只在有活跃下载时才保活
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOADS' }, (response) => {
      if (chrome.runtime.lastError) return
      const tasks = response?.tasks as any[] || []
      const hasActive = tasks.some((t) => t.status === 'downloading' || t.status === 'merging')
      if (!hasActive) {
        // 无活跃下载时不续约 alarm，让 SW 自然休眠
      }
    })
  }
})

// ===== Context Menus =====
function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'detect-videos',
      title: '检测此页视频',
      contexts: ['page', 'frame'],
    })
    chrome.contextMenus.create({
      id: 'download-video',
      title: '下载此视频',
      contexts: ['video'],
    })
    chrome.contextMenus.create({
      id: 'download-link-video',
      title: '下载链接中的视频',
      contexts: ['link'],
    })
  })
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  if (info.menuItemId === 'detect-videos') {
    chrome.tabs.sendMessage(tab.id, { type: 'DETECT_NOW' }).catch(() => {})
  } else if (info.menuItemId === 'download-video' && info.srcUrl) {
    const video: DetectedVideo = {
      id: `ctx_${Date.now()}`,
      url: info.srcUrl,
      title: '',
      format: 'mp4',
      mimeType: '',
      source: 'dom',
      pageUrl: tab.url || '',
      domain: tab.url ? new URL(tab.url).hostname : '',
      detectedAt: Date.now(),
    }
    await createDownloadTask(video, 'chrome')
  }
})

// ===== 补充缺失的文件大小 =====

async function supplementVideoSizes(videos: DetectedVideo[]): Promise<DetectedVideo[]> {
  const needsSize = videos.filter(
    (v) => !v.size && v.source !== 'blob' && v.format !== 'hls' && v.format !== 'dash' && v.url.length > 10
  )
  if (needsSize.length === 0) return videos

  const results = await Promise.allSettled(
    needsSize.map(async (v) => {
      try {
        const resp = await fetch(v.url, { method: 'HEAD' })
        const cl = resp.headers.get('content-length')
        if (cl) {
          const size = parseInt(cl, 10)
          if (size > 0) return { ...v, size }
        }
      } catch {
        // 忽略 HEAD 请求失败（CORS 等限制）
      }
      return v
    })
  )

  // 合并更新后的视频
  const updatedMap = new Map<string, DetectedVideo>()
  for (const result of results) {
    if (result.status === 'fulfilled') {
      updatedMap.set(result.value.url, result.value)
    }
  }

  return videos.map((v) => updatedMap.get(v.url) || v)
}

// ===== 消息路由 =====
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[VideoDownloader] Message error:', error)
        sendResponse({ error: error.message })
      })
    return true
  }
)

async function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender
): Promise<any> {
  switch (message.type) {
    case 'VIDEO_DETECTED': {
      const { pageUrl, videos } = message.payload

      // 补充缺失的文件大小（HEAD 请求）
      const updatedVideos = await supplementVideoSizes(videos)

      pageVideos.set(pageUrl, updatedVideos)
      await saveVideos(pageUrl, updatedVideos)

      // 更新全局 badge（去重 URL 后的总数）
      updateGlobalBadge()

      // 广播更新后的视频列表
      chrome.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        payload: { pageUrl, videos: updatedVideos },
      }).catch(() => {})
      return { success: true }
    }

    case 'CLEAR_ALL_VIDEOS': {
      pageVideos.clear()
      await clearAllVideos()
      updateGlobalBadge()
      return { success: true }
    }

    case 'VIDEO_CLEARED': {
      const pageUrl = message.payload?.pageUrl
      if (pageUrl) {
        pageVideos.delete(pageUrl)
        await clearVideos(pageUrl)
      }
      updateGlobalBadge()
      return { success: true }
    }

    case 'GET_VIDEOS': {
      const pageUrl = message.payload?.pageUrl
      if (pageUrl) {
        const videos = pageVideos.get(pageUrl) || await getVideos(pageUrl)
        return { videos }
      }
      // 合并内存缓存 + storage，确保不丢失任何页面的视频
      const stored = await getAllVideos()
      const mergedMap = new Map<string, any[]>()
      for (const video of stored) {
        const pUrl = video.pageUrl || ''
        if (!mergedMap.has(pUrl)) mergedMap.set(pUrl, [])
        mergedMap.get(pUrl)!.push(video)
      }
      // 内存缓存优先（覆盖 storage 中同页面的旧数据）
      for (const [pUrl, videos] of pageVideos) {
        mergedMap.set(pUrl, videos)
      }
      const all = Array.from(mergedMap.values()).flat()
      return { videos: all }
    }

    case 'START_DOWNLOAD': {
      const { video, downloader } = message.payload
      const task = await createDownloadTask(video, downloader || 'chrome')
      return { task }
    }

    case 'PAUSE_DOWNLOAD': {
      await pauseDownload(message.payload.taskId)
      return { success: true }
    }

    case 'CANCEL_DOWNLOAD': {
      await cancelDownload(message.payload.taskId)
      return { success: true }
    }

    case 'RETRY_DOWNLOAD': {
      await retryDownload(message.payload.taskId)
      return { success: true }
    }

    case 'CLEAR_COMPLETED_DOWNLOADS': {
      await clearCompletedDownloads()
      return { success: true }
    }

    case 'CLEAR_COMPLETED_FULL_DOWNLOADS': {
      await clearCompletedFullDownloads()
      return { success: true }
    }

    case 'CLEAR_FAILED_DOWNLOADS': {
      await clearFailedDownloads()
      return { success: true }
    }

    case 'CLEAR_ORPHANED_DOWNLOADS': {
      const urls = message.payload?.openPageUrls || []
      await clearOrphanedDownloads(urls)
      return { success: true }
    }

    case 'CLEAR_ORPHANED_VIDEOS': {
      const urls = message.payload?.openPageUrls || []
      await clearOrphanedVideos(urls)
      return { success: true }
    }

    case 'CLEAR_PAGE_DOWNLOADS': {
      const pageUrl = message.payload?.pageUrl
      if (pageUrl) {
        await clearPageDownloads(pageUrl)
      }
      return { success: true }
    }

    case 'GET_DOWNLOADS': {
      const tasks = await getAllDownloadTasks()
      return { tasks }
    }

    case 'GET_SETTINGS': {
      const settings = await getFullSettings()
      return { settings }
    }

    case 'UPDATE_SETTINGS': {
      const updated = await patchSettings(message.payload)
      return { settings: updated }
    }

    // ===== 页面下载进度 =====
    case 'PAGE_FETCH_PROGRESS': {
      const { taskId, progress, speed, downloadedBytes, totalBytes } = message.payload
      await updateTaskProgressFromPage(taskId, progress, speed, downloadedBytes, totalBytes)
      return { success: true }
    }

    case 'PAGE_FETCH_ERROR': {
      console.warn('[VideoDownloader] Page fetch error:', message.payload)
      return { success: true }
    }

    case 'PAGE_DOWNLOAD_DONE': {
      const { taskId } = message.payload
      // 通知 download-manager 下载完成
      await cancelDownload(taskId)
      return { success: true }
    }

    case 'SAVE_HELPER_DONE': {
      const { taskId, success, chromeDownloadId } = message.payload
      if (success !== false) {
        await completeDownloadTask(taskId, chromeDownloadId)
      } else {
        await cancelDownload(taskId)
      }
      return { success: true }
    }

    case 'SAVE_HELPER_PROGRESS': {
      const { taskId, progress, speed, downloadedBytes, totalBytes } = message.payload
      await updateTaskProgressFromPage(taskId, progress, speed, downloadedBytes, totalBytes)
      return { success: true }
    }

    // ===== chrome.downloads.onDeterminingFilename 回调 =====
    case 'CHROME_DOWNLOAD_ID': {
      const { taskId, chromeDownloadId } = message.payload
      await updateTaskChromeDownloadId(taskId, chromeDownloadId)
      return { success: true }
    }

    // ===== 重新扫描所有标签页 =====
    case 'RESCAN_ALL_TABS': {
      const tabs = await chrome.tabs.query({})
      for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          chrome.tabs.sendMessage(tab.id, { type: 'DETECT_NOW' }).catch(() => {})
        }
      }
      return { success: true }
    }

    case 'REMOVE_DOWNLOAD': {
      await removeDownloadTask(message.payload.taskId)
      return { success: true }
    }

    case 'CLEAR_VIDEOS_BY_URLS': {
      const urls = message.payload?.urls || []
      await removeVideosByUrls(urls)
      updateGlobalBadge()
      return { success: true }
    }

    default:
      return { error: 'Unknown message type' }
  }
}

// ===== Action 点击打开 SidePanel =====
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id })
    } catch {
      // fallback: popup will show
    }
  }
})

console.log('[VideoDownloader] Background service worker started')
