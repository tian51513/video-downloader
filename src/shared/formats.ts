/**
 * 媒体格式常量（共享单一来源）
 *
 * 此前 types/index.ts 与 injector-script.ts 各持一份手工拷贝（改一边不会
 * 同步另一边）。现在这里是唯一定义：types/index.ts re-export 保持旧导入
 * 路径兼容，injector 打包时从这里取（构建期内联，见 scripts/postbuild.mjs）。
 */

import type { VideoFormat, AudioFormat, MediaFormat } from '../types'

// ===== 视频格式映射 =====

export const VIDEO_EXTENSIONS: Record<string, VideoFormat> = {
  '.mp4': 'mp4',
  '.mkv': 'mkv',
  '.flv': 'flv',
  '.avi': 'avi',
  '.rmvb': 'rmvb',
  '.rm': 'rm',
  '.webm': 'webm',
  '.mov': 'mov',
  '.ts': 'ts',
}

export const HLS_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
]

export const DASH_CONTENT_TYPES = [
  'application/dash+xml',
  'application/xml',
]

// ===== 音频格式映射 =====

export const AUDIO_EXTENSIONS: Record<string, AudioFormat> = {
  '.mp3': 'mp3',
  '.m4a': 'm4a',
  '.aac': 'aac',
  '.flac': 'flac',
  '.ogg': 'ogg',
  '.oga': 'ogg',
  '.wav': 'wav',
  '.wma': 'wma',
  '.opus': 'opus',
}

export const AUDIO_CONTENT_TYPES: Record<string, AudioFormat> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/x-mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-ms-wma': 'wma',
  'audio/wma': 'wma',
  'audio/opus': 'opus',
  'audio/webm': 'opus',
}

export function isAudioFormat(format: string): boolean {
  return ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'opus'].includes(format)
}
