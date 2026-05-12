import type { DetectedVideo, VideoFormat } from '../types'
import { VIDEO_EXTENSIONS } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type ObserverCallback = (video: DetectedVideo) => void

let observer: MutationObserver | null = null
let reportedElements = new WeakSet<Element>()

function getFormatFromSrc(src: string): VideoFormat | null {
  const lower = src.toLowerCase().split('?')[0].split('#')[0]
  if (lower.includes('.m3u8')) return 'hls'
  if (lower.includes('.mpd')) return 'dash'
  for (const [ext, format] of Object.entries(VIDEO_EXTENSIONS)) {
    if (lower.endsWith(ext)) return format
  }
  return null
}

async function analyzeMediaElement(
  element: HTMLVideoElement | HTMLSourceElement | HTMLElement,
  callback: ObserverCallback
): Promise<void> {
  if (reportedElements.has(element)) return

  const src =
    element.getAttribute('src') ||
    element.getAttribute('data-src') ||
    element.getAttribute('data-video-url') ||
    ''

  if (!src) return

  const format = getFormatFromSrc(src)
  if (!format) return

  reportedElements.add(element)

  const fullUrl = new URL(src, window.location.href).href
  const id = await generateVideoFingerprint(fullUrl, format)

  const video: DetectedVideo = {
    id,
    url: fullUrl,
    title: '',
    format,
    mimeType: '',
    source: 'dom',
    pageUrl: window.location.href,
    domain: window.location.hostname,
    detectedAt: Date.now(),
  }

  if (element instanceof HTMLVideoElement) {
    video.width = element.videoWidth || undefined
    video.height = element.videoHeight || undefined
    video.duration = element.duration && isFinite(element.duration) ? element.duration : undefined
  }

  callback(video)
}

async function scanExistingElements(callback: ObserverCallback): Promise<void> {
  const videoElements = document.querySelectorAll('video')
  const sourceElements = document.querySelectorAll('source')

  for (const el of videoElements) {
    await analyzeMediaElement(el as HTMLVideoElement, callback)
  }
  for (const el of sourceElements) {
    await analyzeMediaElement(el as HTMLSourceElement, callback)
  }
}

export function startDomObserver(callback: ObserverCallback): void {
  scanExistingElements(callback)

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node instanceof HTMLVideoElement || node instanceof HTMLSourceElement) {
            analyzeMediaElement(node, callback)
          }
          const videos = node.querySelectorAll('video, source')
          for (const el of videos) {
            analyzeMediaElement(el as HTMLVideoElement | HTMLSourceElement, callback)
          }
        }
      }
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

export function stopDomObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}