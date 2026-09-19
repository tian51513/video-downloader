/**
 * 媒体格式检测（URL / Content-Type → 格式）
 *
 * injector-script 与（历史上的）src/content 各持一份分叉实现（音频支持、
 * 尾斜杠处理不一致），收敛为共享实现。
 */

import type { MediaFormat } from '../types'
import {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  HLS_CONTENT_TYPES,
  DASH_CONTENT_TYPES,
  AUDIO_CONTENT_TYPES,
} from './formats'

export function detectFormatFromUrl(url: string): MediaFormat | null {
  const lower = url.toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '')
  if (lower.includes('.m3u8')) return 'hls'
  if (lower.includes('.mpd')) return 'dash'
  for (const ext in VIDEO_EXTENSIONS) {
    if (lower.endsWith(ext)) return VIDEO_EXTENSIONS[ext]
  }
  for (const ext in AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) return AUDIO_EXTENSIONS[ext]
  }
  return null
}

export function detectFormatFromContentType(contentType: string): MediaFormat | null {
  const lower = contentType.toLowerCase()
  for (let i = 0; i < HLS_CONTENT_TYPES.length; i++) {
    if (lower.includes(HLS_CONTENT_TYPES[i])) return 'hls'
  }
  for (let i = 0; i < DASH_CONTENT_TYPES.length; i++) {
    if (lower.includes(DASH_CONTENT_TYPES[i])) return 'dash'
  }
  // 音频 MIME 检测（忽略 ; charset= 参数）
  const semicolonIdx = lower.indexOf(';')
  const mimeBase = semicolonIdx >= 0 ? lower.substring(0, semicolonIdx) : lower
  if (AUDIO_CONTENT_TYPES[mimeBase]) return AUDIO_CONTENT_TYPES[mimeBase]
  return null
}

export function isMediaRequest(url: string, contentType?: string): boolean {
  return (
    detectFormatFromUrl(url) !== null ||
    (contentType ? detectFormatFromContentType(contentType) !== null : false)
  )
}

/**
 * 将页面内捕获的 URL（页面 fetch/XHR 的原始参数可能是相对路径，
 * 如 '480p/index.m3u8?n=...'）解析为绝对地址。
 * 无法解析时原样返回。相对 URL 若不解析直接上报，background SW
 * 中的 fetch 将因缺少基准地址而失败（TypeError: Failed to fetch）。
 */
export function normalizeReportUrl(url: string, pageUrl: string): string {
  try {
    return new URL(url, pageUrl).href
  } catch {
    return url
  }
}
