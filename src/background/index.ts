import { initDefaultSettings, getFullSettings, patchSettings, resetToDefaults } from './settings'
import {
  createDownloadTask,
  pauseDownload,
  cancelDownload,
  getAllDownloadTasks,
} from './download-manager'
import type { DetectedVideo, ExtensionMessage } from '../types'
import { saveVideos, getVideos, clearVideos } from '../utils/storage'

const pageVideos = new Map<string, DetectedVideo[]>()

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[VideoDownloader] Extension installed')
  await initDefaultSettings()
  setupContextMenus()
})

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
      pageVideos.set(pageUrl, videos)
      await saveVideos(pageUrl, videos)
      chrome.runtime.sendMessage(message).catch(() => {})
      return { success: true }
    }

    case 'VIDEO_CLEARED': {
      const pageUrl = message.payload?.pageUrl
      if (pageUrl) {
        pageVideos.delete(pageUrl)
        await clearVideos(pageUrl)
      }
      return { success: true }
    }

    case 'GET_VIDEOS': {
      const pageUrl = message.payload?.pageUrl
      if (pageUrl) {
        const videos = pageVideos.get(pageUrl) || await getVideos(pageUrl)
        return { videos }
      }
      return { videos: Array.from(pageVideos.values()).flat() }
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

    default:
      return { error: 'Unknown message type' }
  }
}

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
