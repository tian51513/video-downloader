import type { DetectedVideo, VideoEncryption } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type ParserCallback = (videos: DetectedVideo[]) => void

interface HLSStream {
  bandwidth: number
  resolution?: { width: number; height: number }
  codecs?: string
  url: string
}

interface HLSEncryption {
  method: string
  keyUrl?: string
  iv?: string
}

function parseM3U8(content: string): {
  isMaster: boolean
  streams: HLSStream[]
  segments: string[]
  encryption?: HLSEncryption
} {
  const lines = content.split('\n').map((l) => l.trim())

  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))

  let encryption: HLSEncryption | undefined
  const keyLine = lines.find((l) => l.startsWith('#EXT-X-KEY:'))
  if (keyLine) {
    const methodMatch = keyLine.match(/METHOD=([^,\s]+)/)
    const uriMatch = keyLine.match(/URI="([^"]+)"/)
    const ivMatch = keyLine.match(/IV=0x([0-9a-fA-F]+)/)
    encryption = {
      method: methodMatch?.[1] || '',
      keyUrl: uriMatch?.[1],
      iv: ivMatch?.[1],
    }
  }

  if (isMaster) {
    const streams: HLSStream[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
        const line = lines[i]
        let url = ''
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j] && !lines[j].startsWith('#')) {
            url = lines[j].trim()
            break
          }
        }

        const bandwidth = parseInt(
          line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10
        )
        const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/)
        const codecsMatch = line.match(/CODECS="([^"]+)"/)

        streams.push({
          bandwidth,
          resolution: resMatch
            ? { width: parseInt(resMatch[1], 10), height: parseInt(resMatch[2], 10) }
            : undefined,
          codecs: codecsMatch?.[1],
          url,
        })
      }
    }
    return { isMaster: true, streams, segments: [], encryption }
  } else {
    const segments: string[] = []
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        segments.push(line)
      }
    }
    return { isMaster: false, streams: [], segments, encryption }
  }
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

export async function parseHLS(
  m3u8Url: string,
  pageUrl: string,
  callback: ParserCallback
): Promise<void> {
  try {
    const response = await fetch(m3u8Url)
    if (!response.ok) return

    const content = await response.text()
    const parsed = parseM3U8(content)

    if (parsed.isMaster && parsed.streams.length > 0) {
      const videos: DetectedVideo[] = []

      for (const stream of parsed.streams) {
        const fullUrl = resolveUrl(m3u8Url, stream.url)
        const quality = stream.resolution
          ? `${stream.resolution.width}x${stream.resolution.height}`
          : `${Math.round(stream.bandwidth / 1000)}kbps`

        const id = await generateVideoFingerprint(fullUrl, quality)

        const encryption: VideoEncryption | undefined = parsed.encryption
          ? {
              method: parsed.encryption.method,
              keyUrl: parsed.encryption.keyUrl
                ? resolveUrl(m3u8Url, parsed.encryption.keyUrl)
                : undefined,
            }
          : undefined

        videos.push({
          id,
          url: fullUrl,
          title: '',
          format: 'hls',
          mimeType: 'application/vnd.apple.mpegurl',
          size: undefined,
          width: stream.resolution?.width,
          height: stream.resolution?.height,
          bitrate: stream.bandwidth,
          source: 'network',
          pageUrl,
          domain: new URL(pageUrl).hostname,
          encryption,
          detectedAt: Date.now(),
        })
      }

      callback(videos)
    } else if (!parsed.isMaster && parsed.segments.length > 0) {
      const resolvedSegments = parsed.segments.map((s) => resolveUrl(m3u8Url, s))
      const id = await generateVideoFingerprint(m3u8Url, 'hls')

      const encryption: VideoEncryption | undefined = parsed.encryption
        ? {
            method: parsed.encryption.method,
            keyUrl: parsed.encryption.keyUrl
              ? resolveUrl(m3u8Url, parsed.encryption.keyUrl)
              : undefined,
          }
        : undefined

      callback([
        {
          id,
          url: m3u8Url,
          title: '',
          format: 'hls',
          mimeType: 'application/vnd.apple.mpegurl',
          segments: resolvedSegments,
          source: 'network',
          pageUrl,
          domain: new URL(pageUrl).hostname,
          encryption,
          detectedAt: Date.now(),
        },
      ])
    }
  } catch (error) {
    console.error('[VideoDownloader] HLS parse error:', error)
  }
}