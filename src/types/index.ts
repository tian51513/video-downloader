// src/types/index.ts

// ===== 视频检测 =====

export type VideoFormat =
  | 'mp4' | 'mkv' | 'flv' | 'avi' | 'rmvb' | 'rm'
  | 'webm' | 'mov' | 'ts'
  | 'hls' | 'dash' | 'blob'

export type AudioFormat =
  | 'mp3' | 'm4a' | 'aac' | 'flac' | 'ogg' | 'wav' | 'wma' | 'opus'

export type MediaFormat = VideoFormat | AudioFormat

export type MediaType = 'video' | 'audio'

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
  format: MediaFormat
  mimeType: string
  mediaType?: MediaType
  size?: number
  width?: number
  height?: number
  sampleRate?: number
  channels?: number
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
  /** 打开浏览器"另存为"对话框（运行时三处使用，此前类型缺失已漂移） */
  askSaveLocation?: boolean
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
  savedFileName?: string
  chromeDownloadId?: number
  error?: string
  downloader: DownloaderType
  startedAt?: number
  completedAt?: number
  detectedAt?: number
}

// ===== 视频分组 =====

export interface VideoGroup {
  title: string
  pageUrl: string
  versions: DetectedVideo[]
  primaryIndex: number
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

/** 指定分辨率（精确档位匹配；与 minResolution 阈值筛选可叠加） */
export type FilterExactResolution = 'any' | '4k' | '1440p' | '1080p' | '720p' | '480p' | '360p' | 'low'
export type FilterSize = 'any' | '10mb' | '50mb' | '100mb' | '500mb'
export type FilterDuration = 'any' | '1min' | '5min' | '10min' | '30min'
export type FilterVideoType = 'all' | 'regular' | 'streaming' | 'blob' | 'audio'

export interface VideoFilter {
  formats: MediaFormat[]
  minResolution: FilterResolution
  exactResolution: FilterExactResolution
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
  | 'START_DOWNLOAD'
  | 'PAUSE_DOWNLOAD'
  | 'CANCEL_DOWNLOAD'
  | 'RETRY_DOWNLOAD'
  | 'DOWNLOAD_PROGRESS'
  | 'GET_DOWNLOADS'
  | 'CLEAR_ALL_VIDEOS'
  | 'CLEAR_COMPLETED_DOWNLOADS'
  | 'CLEAR_COMPLETED_FULL_DOWNLOADS'
  | 'CLEAR_FAILED_DOWNLOADS'
  | 'CLEAR_ORPHANED_DOWNLOADS'
  | 'CLEAR_ORPHANED_VIDEOS'
  | 'CLEAR_PAGE_DOWNLOADS'
  | 'PAGE_FETCH_PROGRESS'
  | 'PAGE_FETCH_ERROR'
  | 'PAGE_DOWNLOAD_DONE'
  | 'SAVE_HELPER_DONE'
  | 'SAVE_HELPER_PROGRESS'
  | 'SAVE_VIA_CHROME_DOWNLOADS'
  | 'SUPPRESS_FRAGMENTS'
  | 'RESCAN_ALL_TABS'
  | 'SAVE_HELPER_FETCH_DOWNLOAD'
  | 'REMOVE_DOWNLOAD'
  | 'CLEAR_VIDEOS_BY_URLS'
  | 'DETECT_NOW'
  | 'GET_PAGE_VIDEOS'
  | 'CLEAR_PAGE_VIDEOS'

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
    askSaveLocation: false,
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
    formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash', 'mp3', 'm4a', 'flac', 'ogg', 'wav'],
    minResolution: 'any',
    exactResolution: 'any',
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

// ===== 格式常量已移至 src/shared/formats.ts（与 injector-script 共享单一来源）=====

export {
  VIDEO_EXTENSIONS,
  HLS_CONTENT_TYPES,
  DASH_CONTENT_TYPES,
  AUDIO_EXTENSIONS,
  AUDIO_CONTENT_TYPES,
  isAudioFormat,
} from '../shared/formats'