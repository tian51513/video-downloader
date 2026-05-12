// src/types/index.ts

// ===== 视频检测 =====

export type VideoFormat =
  | 'mp4' | 'mkv' | 'flv' | 'avi' | 'rmvb' | 'rm'
  | 'webm' | 'mov' | 'ts'
  | 'hls' | 'dash' | 'blob'

export type DetectionSource = 'network' | 'dom' | 'blob'

export type DownloaderType = 'chrome' | 'idm' | 'aria2' | 'motrix' | 'custom'

export type DownloadStatus =
  | 'pending' | 'downloading' | 'merging'
  | 'completed' | 'failed' | 'paused'

export interface VideoEncryption {
  method: string
  keyUrl?: string
}

export interface DetectedVideo {
  id: string
  url: string
  title: string
  format: VideoFormat
  mimeType: string
  size?: number
  width?: number
  height?: number
  duration?: number
  bitrate?: number
  source: DetectionSource
  pageUrl: string
  domain: string
  segments?: string[]
  encryption?: VideoEncryption
  detectedAt: number
}

// ===== 下载管理 =====

export interface DownloadSettings {
  maxConcurrent: number
  retryCount: number
  retryDelay: number
  timeout: number
  chunkSize?: number
}

export interface DownloadTask {
  id: string
  video: DetectedVideo
  status: DownloadStatus
  progress: number
  speed: number
  downloadedBytes: number
  totalBytes: number
  filePath?: string
  error?: string
  downloader: DownloaderType
  startedAt?: number
  completedAt?: number
}

// ===== 黑名单 =====

export type BlacklistMatchType = 'domain' | 'url' | 'regex'

export interface BlacklistRule {
  id: string
  pattern: string
  type: BlacklistMatchType
  reason?: string
  enabled: boolean
}

// ===== 过滤 =====

export type FilterResolution = 'any' | '4k' | '1080p' | '720p' | '480p' | '360p'
export type FilterSize = 'any' | '10mb' | '50mb' | '100mb' | '500mb'
export type FilterDuration = 'any' | '1min' | '5min' | '10min' | '30min'
export type FilterVideoType = 'all' | 'regular' | 'streaming' | 'blob'

export interface VideoFilter {
  formats: VideoFormat[]
  minResolution: FilterResolution
  minSize: FilterSize
  minDuration: FilterDuration
  sources: string[]
  videoType: FilterVideoType
  sortBy: 'detectedAt' | 'size' | 'resolution' | 'duration'
  sortOrder: 'desc' | 'asc'
}

// ===== 设置 =====

export type ThemeMode = 'light' | 'dark' | 'system'
export type ListDensity = 'compact' | 'standard' | 'detailed'

export interface AppSettings {
  downloadSettings: DownloadSettings
  defaultDownloader: DownloaderType
  baseSaveDirectory: string
  saveByDomain: boolean
  customSaveRules: CustomSaveRule[]
  namingTemplate: string
  blacklist: BlacklistRule[]
  filter: VideoFilter
  themeMode: ThemeMode
  accentColor: string
  language: 'zh' | 'en'
  popupWidth: 320 | 400 | 500
  listDensity: ListDensity
  visibleColumns: VisibleColumn[]
  notifications: boolean
  notificationSound: boolean
  autoCleanupDays: number
  shortcuts: Record<string, string>
  externalDownloaderConfig: ExternalDownloaderConfig
}

export interface CustomSaveRule {
  id: string
  domainPattern: string
  savePath: string
  enabled: boolean
}

export type VisibleColumn =
  | 'format' | 'size' | 'resolution'
  | 'duration' | 'source' | 'detectedAt'

export interface ExternalDownloaderConfig {
  aria2RpcUrl: string
  aria2RpcSecret: string
  idmPath: string
  customCommand: string
  customCommandArgs: string
}

// ===== 消息通信 =====

export type MessageType =
  | 'VIDEO_DETECTED'
  | 'VIDEO_CLEARED'
  | 'GET_VIDEOS'
  | 'GET_VIDEOS_RESPONSE'
  | 'START_DOWNLOAD'
  | 'PAUSE_DOWNLOAD'
  | 'CANCEL_DOWNLOAD'
  | 'DOWNLOAD_PROGRESS'
  | 'DOWNLOAD_COMPLETE'
  | 'DOWNLOAD_FAILED'
  | 'GET_SETTINGS'
  | 'GET_SETTINGS_RESPONSE'
  | 'UPDATE_SETTINGS'
  | 'GET_DOWNLOADS'
  | 'GET_DOWNLOADS_RESPONSE'
  | 'PREVIEW_VIDEO'
  | 'FILTER_VIDEOS'

export interface ExtensionMessage {
  type: MessageType
  payload?: any
}

// ===== 默认值 =====

export const DEFAULT_SETTINGS: AppSettings = {
  downloadSettings: {
    maxConcurrent: 3,
    retryCount: 3,
    retryDelay: 1000,
    timeout: 30000,
  },
  defaultDownloader: 'chrome',
  baseSaveDirectory: '',
  saveByDomain: true,
  customSaveRules: [],
  namingTemplate: '{name}.{format}',
  blacklist: [
    { id: 'default-1', pattern: 'doubleclick.net', type: 'domain', reason: '广告追踪', enabled: true },
    { id: 'default-2', pattern: 'googlesyndication.com', type: 'domain', reason: '广告追踪', enabled: true },
    { id: 'default-3', pattern: 'adnxs.com', type: 'domain', reason: '广告追踪', enabled: true },
    { id: 'default-4', pattern: 'adservice.google.com', type: 'domain', reason: '广告追踪', enabled: true },
  ],
  filter: {
    formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash'],
    minResolution: 'any',
    minSize: 'any',
    minDuration: 'any',
    sources: [],
    videoType: 'all',
    sortBy: 'detectedAt',
    sortOrder: 'desc',
  },
  themeMode: 'system',
  accentColor: '#1677ff',
  language: 'zh',
  popupWidth: 400,
  listDensity: 'standard',
  visibleColumns: ['format', 'size', 'resolution', 'duration', 'source'],
  notifications: true,
  notificationSound: false,
  autoCleanupDays: 30,
  shortcuts: {},
  externalDownloaderConfig: {
    aria2RpcUrl: 'http://localhost:6800/jsonrpc',
    aria2RpcSecret: '',
    idmPath: '',
    customCommand: '',
    customCommandArgs: '',
  },
}

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