import type { DetectedVideo, VideoFormat } from '../types'
import { VIDEO_EXTENSIONS, HLS_CONTENT_TYPES, DASH_CONTENT_TYPES } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type InterceptorCallback = (video: DetectedVideo) => void

function detectFormatFromUrl(url: string): VideoFormat | null {
  const lower = url.toLowerCase().split('?')[0].split('#')[0]
  if (lower.includes('.m3u8')) return 'hls'
  if (lower.includes('.mpd')) return 'dash'
  for (const [ext, format] of Object.entries(VIDEO_EXTENSIONS)) {
    if (lower.endsWith(ext)) return format
  }
  return null
}

function detectFormatFromContentType(contentType: string): VideoFormat | null {
  const lower = contentType.toLowerCase()
  for (const hlsType of HLS_CONTENT_TYPES) {
    if (lower.includes(hlsType)) return 'hls'
  }
  for (const dashType of DASH_CONTENT_TYPES) {
    if (lower.includes(dashType)) return 'dash'
  }
  return null
}

function isVideoRequest(url: string, contentType?: string): boolean {
  return detectFormatFromUrl(url) !== null ||
    (contentType ? detectFormatFromContentType(contentType) !== null : false)
}

function hookXHR(callback: InterceptorCallback): void {
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: any[]) {
    const urlString = url.toString()
    ;(this as any).__interceptedUrl = urlString
    ;(this as any).__interceptedContentType = ''
    return originalOpen.call(this, method, url, ...args) as any
  }

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    const xhr = this as any
    const url = xhr.__interceptedUrl as string

    if (url && isVideoRequest(url)) {
      const format = detectFormatFromUrl(url)

      if (format) {
        xhr.addEventListener('readystatechange', () => {
          if (xhr.readyState === 2) {
            const contentType = xhr.getResponseHeader('content-type') || ''
            if (format === 'hls' && !HLS_CONTENT_TYPES.some((t) => contentType.toLowerCase().includes(t))) {
              return
            }
            reportVideo(url, format, contentType, callback)
          }
        })
      }
    }

    return originalSend.apply(this, args) as any
  }
}

function hookFetch(callback: InterceptorCallback): void {
  const originalFetch = window.fetch

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url

    const response = await originalFetch.call(this, input, init)

    if (url && isVideoRequest(url)) {
      const format = detectFormatFromUrl(url)
      const contentType = response.headers.get('content-type') || ''

      if (format && isVideoRequest(url, contentType)) {
        reportVideo(url, format, contentType, callback)
      }
    }

    return response
  }
}

let reportedUrls = new Set<string>()

async function reportVideo(
  url: string,
  format: VideoFormat,
  contentType: string,
  callback: InterceptorCallback
) {
  if (reportedUrls.has(url)) return
  reportedUrls.add(url)

  if (url.length < 10) return

  const id = await generateVideoFingerprint(url, format)

  const video: DetectedVideo = {
    id,
    url,
    title: '',
    format,
    mimeType: contentType,
    source: 'network',
    pageUrl: window.location.href,
    domain: window.location.hostname,
    detectedAt: Date.now(),
  }

  callback(video)
}

export function startNetworkInterception(callback: InterceptorCallback): void {
  hookXHR(callback)
  hookFetch(callback)
}

export function stopNetworkInterception(): void {
  reportedUrls.clear()
}
