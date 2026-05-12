import type { PlasmoCSConfig } from 'plasmo'
import type { DetectedVideo, BlacklistRule } from '../types'
import { startNetworkInterception, stopNetworkInterception } from './network-interceptor'
import { startDomObserver, stopDomObserver } from './dom-observer'
import { parseHLS } from './hls-parser'
import { parseDASH } from './dash-parser'
import { hookBlobCreation, unhookBlobCreation } from './blob-handler'
import { detectVideoName } from './name-detector'

export const config: PlasmoCSConfig = {
  matches: ['<all_urls>'],
  world: 'MAIN',
  run_at: 'document_start',
}

let detectedVideos: Map<string, DetectedVideo> = new Map()
let nameCache: string | null = null

function isBlacklisted(url: string, blacklist: BlacklistRule[]): boolean {
  return blacklist
    .filter((r) => r.enabled)
    .some((rule) => {
      try {
        if (rule.type === 'domain') {
          return new URL(url).hostname.includes(rule.pattern)
        } else if (rule.type === 'regex') {
          return new RegExp(rule.pattern).test(url)
        } else {
          return url.includes(rule.pattern)
        }
      } catch {
        return false
      }
    })
}

function getPageName(): string {
  if (!nameCache) {
    nameCache = detectVideoName()
  }
  return nameCache
}

function handleDetectedVideo(video: DetectedVideo): void {
  if (detectedVideos.has(video.id)) return

  chrome.storage.local.get('app-settings', (result) => {
    const settings = result['app-settings']
    const blacklist = settings?.blacklist || []

    if (isBlacklisted(video.url, blacklist)) {
      return
    }

    video.title = getPageName()
    detectedVideos.set(video.id, video)

    if (video.format === 'hls' && !video.segments) {
      parseHLS(video.url, video.pageUrl, (hlsVideos) => {
        for (const hv of hlsVideos) {
          hv.title = video.title || getPageName()
          detectedVideos.set(hv.id, hv)
        }
        sendVideosToBackground()
      })
    } else if (video.format === 'dash') {
      parseDASH(video.url, video.pageUrl, (dashVideos) => {
        for (const dv of dashVideos) {
          dv.title = video.title || getPageName()
          detectedVideos.set(dv.id, dv)
        }
        sendVideosToBackground()
      })
    }

    sendVideosToBackground()
  })
}

function sendVideosToBackground(): void {
  const videos = Array.from(detectedVideos.values())
  chrome.runtime.sendMessage({
    type: 'VIDEO_DETECTED',
    payload: {
      pageUrl: window.location.href,
      videos,
    },
  }).catch(() => {
    // Extension may not be ready, ignore
  })
}

function init(): void {
  startNetworkInterception(handleDetectedVideo)
  startDomObserver(handleDetectedVideo)
  hookBlobCreation(handleDetectedVideo)

  window.addEventListener('beforeunload', () => {
    stopNetworkInterception()
    stopDomObserver()
    unhookBlobCreation()
  })

  console.log('[VideoDownloader] Content script initialized')
}

init()
