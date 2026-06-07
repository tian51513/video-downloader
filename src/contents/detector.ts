import type { PlasmoCSConfig } from 'plasmo'

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  run_at: 'document_start',
  all_frames: true,
}

const detectedVideos = new Map<string, DetectedVideo>()

// 防止 Extension context invalidated 错误
function isExtensionContextValid(): boolean {
  try {
    return chrome.runtime?.id !== undefined
  } catch {
    return false
  }
}

interface DetectedVideo {
  id: string
  url: string
  title: string
  format: string
  mimeType: string
  mediaType?: string
  source: string
  pageUrl: string
  domain: string
  size?: number
  width?: number
  height?: number
  sampleRate?: number
  channels?: number
  duration?: number
  bitrate?: number
  detectedAt: number
}

function handleDetectedVideo(video: DetectedVideo): void {
  if (!isExtensionContextValid()) return
  if (detectedVideos.has(video.id)) return

  // 黑名单过滤
  chrome.storage.local.get('app-settings', (result) => {
    const settings = result['app-settings']
    const blacklist = settings?.blacklist || []

    const isBlocked = blacklist
      .filter((r: any) => r.enabled)
      .some((rule: any) => {
        try {
          if (rule.type === 'domain') {
            return new URL(video.url).hostname.includes(rule.pattern)
          } else if (rule.type === 'regex') {
            return new RegExp(rule.pattern).test(video.url)
          } else {
            return video.url.includes(rule.pattern)
          }
        } catch {
          return false
        }
      })

    if (isBlocked) return

    detectedVideos.set(video.id, video)
    sendVideosToBackground()
  })
}

function sendVideosToBackground(): void {
  if (!isExtensionContextValid()) return
  const videos = Array.from(detectedVideos.values())

  chrome.runtime.sendMessage({
    type: 'VIDEO_DETECTED',
    payload: {
      pageUrl: window.location.href,
      videos,
    },
  }).catch(() => {})

}

// 监听来自 MAIN world 的消息
window.addEventListener('message', (event) => {
  if (event.source !== window) return

  // 转发 MAIN world 的下载进度到 background（MAIN world 无法使用 chrome.runtime）
  if (event.data?.type === 'PAGE_FETCH_PROGRESS') {
    const payload = event.data.payload
    if (payload?.taskId && isExtensionContextValid()) {
      chrome.runtime.sendMessage({
        type: 'PAGE_FETCH_PROGRESS',
        payload,
      }).catch(() => {})
    }
    return
  }

  // 转发 MAIN world 的诊断错误到 background
  if (event.data?.type === 'PAGE_FETCH_ERROR') {
    const payload = event.data.payload
    if (payload?.taskId && isExtensionContextValid()) {
      chrome.runtime.sendMessage({
        type: 'PAGE_FETCH_ERROR',
        payload,
      }).catch(() => {})
    }
    return
  }

  // 转发 MAIN world 的下载完成通知到 background
  if (event.data?.type === 'PAGE_DOWNLOAD_DONE') {
    const payload = event.data.payload
    if (payload?.taskId && isExtensionContextValid()) {
      chrome.runtime.sendMessage({
        type: 'PAGE_DOWNLOAD_DONE',
        payload,
      }).catch(() => {})
    }
    return
  }

  if (event.data?.type !== 'VIDEO_DOWNLOADER_DETECT') return

  const video = event.data.payload
  if (video && video.url) {
    // 如果已有此视频且有 width/height 更新，则更新元数据
    const existing = detectedVideos.get(video.id)
    if (existing) {
      let updated = false
      if (video.width && video.width !== existing.width) { existing.width = video.width; updated = true }
      if (video.height && video.height !== existing.height) { existing.height = video.height; updated = true }
      if (video.duration && video.duration !== existing.duration) { existing.duration = video.duration; updated = true }
      if (video.bitrate && video.bitrate !== existing.bitrate) { existing.bitrate = video.bitrate; updated = true }
      if (video.title && video.title !== existing.title) { existing.title = video.title; updated = true }
      if (video.size && video.size > 0 && (!existing.size || existing.size !== video.size)) { existing.size = video.size; updated = true }
      if (video.sampleRate && video.sampleRate !== existing.sampleRate) { existing.sampleRate = video.sampleRate; updated = true }
      if (video.channels && video.channels !== existing.channels) { existing.channels = video.channels; updated = true }
      if (video.mediaType && video.mediaType !== existing.mediaType) { existing.mediaType = video.mediaType; updated = true }
      if (updated) sendVideosToBackground()
      return
    }
    handleDetectedVideo(video)
  }
})

// 监听来自 Background / Popup 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionContextValid()) return
  if (message.type === 'DETECT_NOW') {
    // 清除本地缓存，允许重新上报
    detectedVideos.clear()
    // 通知 MAIN world 重新扫描（清除 reportedUrls + 重新执行 DOM/iframe/config scan）
    window.postMessage({ type: 'VIDEO_DOWNLOADER_RESCAN' }, '*')
    sendResponse({ success: true })
  } else if (message.type === 'GET_PAGE_VIDEOS') {
    const videos = Array.from(detectedVideos.values())
    sendResponse({ videos })
  } else if (message.type === 'CLEAR_PAGE_VIDEOS') {
    detectedVideos.clear()
    sendResponse({ success: true })
  }
  return true
})

// 页面导航清理
window.addEventListener('beforeunload', () => {
  detectedVideos.clear()
})

console.log('[VideoDownloader] ISOLATED world detector initialized')

export {}
