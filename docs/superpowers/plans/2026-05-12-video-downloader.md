# 视频下载 Chrome 扩展 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Chrome 浏览器扩展，能够检测网页中的常规视频、HLS 和 DASH 流媒体，提供智能命名、过滤、预览和下载功能。

**Architecture:** Content Script 注入页面拦截网络请求和监听 DOM，将检测到的视频信息发送给 Background Service Worker。Worker 管理下载队列和设置。三层 UI（Popup/SidePanel/Options）通过 Plasmo messaging 与 Worker 通信，Zustand 管理共享状态。

**Tech Stack:** Plasmo, React 18, TypeScript, Ant Design, Zustand, HLS.js, dash.js, dayjs

---

## 阶段 1：项目基础

### Task 1: 项目脚手架初始化

**Files:**
- Create: `package.json`
- Create: `plasmo.json`
- Create: `tsconfig.json`
- Create: `tailwind.config.ts` (可选，Ant Design 为主)
- Create: `src/assets/icon16.png`
- Create: `src/assets/icon48.png`
- Create: `src/assets/icon128.png`
- Create: `package.json` 权限配置

- [ ] **Step 1: 用 Plasmo 初始化项目**

Run:
```bash
cd F:/project/video-downloader
pnpm create plasmo . --name video-downloader
```

如果提示目录非空，手动创建项目结构。

- [ ] **Step 2: 安装核心依赖**

```bash
cd F:/project/video-downloader
pnpm add react react-dom
pnpm add antd @ant-design/icons
pnpm add zustand
pnpm add hls.js dashjs
pnpm add dayjs
pnpm add -D @types/react @types/react-dom @types/chrome
```

- [ ] **Step 3: 配置 Manifest V3 权限**

在 `package.json` 中添加 Plasmo manifest 配置：

```json
{
  "manifest": {
    "permissions": [
      "downloads",
      "storage",
      "sidePanel",
      "contextMenus",
      "activeTab"
    ],
    "host_permissions": [
      "<all_urls>"
    ]
  }
}
```

- [ ] **Step 4: 创建目录结构**

```bash
mkdir -p src/{background,content,popup/components,sidepanel/components,options/components,preview/components,store,types,utils,assets}
mkdir -p docs/superpowers/{specs,plans}
```

- [ ] **Step 5: 验证开发环境能启动**

Run:
```bash
pnpm dev
```

Expected: Plasmo 编译成功，Chrome 自动打开加载扩展。可以在 `chrome://extensions` 中看到扩展已加载。

- [ ] **Step 6: 初始提交**

```bash
git init
git add .
git commit -m "feat: init Plasmo project with dependencies and directory structure"
```

---

### Task 2: TypeScript 类型定义

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: 定义核心类型**

```typescript
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
  // 下载设置
  downloadSettings: DownloadSettings
  defaultDownloader: DownloaderType
  baseSaveDirectory: string
  saveByDomain: boolean
  customSaveRules: CustomSaveRule[]

  // 命名设置
  namingTemplate: string

  // 黑名单
  blacklist: BlacklistRule[]

  // 过滤设置
  filter: VideoFilter

  // 界面设置
  themeMode: ThemeMode
  accentColor: string
  language: 'zh' | 'en'
  popupWidth: 320 | 400 | 500
  listDensity: ListDensity
  visibleColumns: VisibleColumn[]
  notifications: boolean
  notificationSound: boolean
  autoCleanupDays: number

  // 快捷键
  shortcuts: Record<string, string>

  // 外部下载器配置
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
  'application/xml', // 部分站点 MPD 使用通用 XML 类型
]
```

- [ ] **Step 2: 提交**

```bash
git add src/types/index.ts
git commit -m "feat: add TypeScript type definitions and defaults"
```

---

### Task 3: 工具函数

**Files:**
- Create: `src/utils/sanitize.ts`
- Create: `src/utils/format.ts`
- Create: `src/utils/storage.ts`
- Create: `src/utils/hash.ts`

- [ ] **Step 1: 实现文件名清洗**

```typescript
// src/utils/sanitize.ts

/**
 * 检测文本是否为乱码或无意义的 ID
 */
export function isGarbled(text: string): boolean {
  if (!text || text.trim().length === 0) return true

  // 纯数字且超过 4 位 → 视为 ID
  if (/^\d{4,}$/.test(text)) return true

  // 长十六进制字符串（常见于 hash URL）
  if (/^[0-9a-f]{16,}$/i.test(text)) return true

  // URL 编码比例过高
  const encodedRatio =
    (text.match(/%[0-9a-f]{2}/gi) || []).length / text.length
  if (encodedRatio > 0.3) return true

  // Unicode 乱码检测（大量连续不可见字符）
  const garbledRatio =
    (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length /
    text.length
  if (garbledRatio > 0.2) return true

  return false
}

/**
 * 清洗文件名，去除非法字符
 */
export function sanitizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .substring(0, 200)
}

/**
 * 根据命名模板生成文件名
 */
export function buildFileName(
  template: string,
  vars: Record<string, string>
): string {
  let name = template
  for (const [key, value] of Object.entries(vars)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return sanitizeName(name)
}
```

- [ ] **Step 2: 实现格式化工具**

```typescript
// src/utils/format.ts

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '未知'
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)

  if (i === 0) return `${bytes} B`
  return `${size.toFixed(i <= 2 ? 1 : 0)} ${units[i]}`
}

/**
 * 格式化时长（秒 → mm:ss 或 hh:mm:ss）
 */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '未知'
  if (!isFinite(seconds) || seconds < 0) return '未知'

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  const pad = (n: number) => n.toString().padStart(2, '0')

  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

/**
 * 格式化分辨率
 */
export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return '未知'
  return `${width}x${height}`
}

/**
 * 格式化速度（字节/秒 → 人类可读）
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatFileSize(bytesPerSecond)}/s`
}

/**
 * 格式化码率
 */
export function formatBitrate(bitrate?: number): string {
  if (!bitrate) return '未知'
  if (bitrate >= 1_000_000) return `${(bitrate / 1_000_000).toFixed(1)} Mbps`
  if (bitrate >= 1_000) return `${(bitrate / 1_000).toFixed(0)} Kbps`
  return `${bitrate} bps`
}

/**
 * 格式化下载进度百分比
 */
export function formatProgress(progress: number): string {
  return `${Math.min(100, Math.max(0, progress)).toFixed(1)}%`
}

/**
 * 获取分辨率标签（如 1080p, 720p）
 */
export function getResolutionLabel(width?: number, height?: number): string {
  if (!height) return ''
  if (height >= 2160) return '4K'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  if (height >= 480) return '480p'
  if (height >= 360) return '360p'
  return `${height}p`
}
```

- [ ] **Step 3: 实现 hash 工具**

```typescript
// src/utils/hash.ts

/**
 * 生成简易哈希字符串，用于视频去重指纹
 * 注意：这不是加密安全的哈希，仅用于去重
 */
export async function simpleHash(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  // 取前 16 个字符作为指纹
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 生成视频唯一指纹
 */
export async function generateVideoFingerprint(
  url: string,
  quality?: string
): Promise<string> {
  const raw = `${url}|${quality || ''}`
  return await simpleHash(raw)
}
```

- [ ] **Step 4: 实现 chrome.storage 封装**

```typescript
// src/utils/storage.ts

import { DEFAULT_SETTINGS, type AppSettings } from '../types'

const SETTINGS_KEY = 'app-settings'
const VIDEOS_KEY = 'detected-videos'
const DOWNLOADS_KEY = 'download-tasks'

/**
 * 获取设置，合并默认值
 */
export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  const stored = result[SETTINGS_KEY] as Partial<AppSettings> | undefined
  if (!stored) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...stored }
}

/**
 * 保存设置（部分更新）
 */
export async function updateSettings(
  partial: Partial<AppSettings>
): Promise<void> {
  const current = await getSettings()
  const updated = { ...current, ...partial }
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated })
}

/**
 * 保存检测到的视频列表（按页面 URL 分组存储）
 */
export async function saveVideos(
  pageUrl: string,
  videos: any[]
): Promise<void> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  all[pageUrl] = videos
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

/**
 * 获取指定页面的视频列表
 */
export async function getVideos(pageUrl: string): Promise<any[]> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  return all[pageUrl] || []
}

/**
 * 清除指定页面的视频列表
 */
export async function clearVideos(pageUrl: string): Promise<void> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  delete all[pageUrl]
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

/**
 * 保存下载任务
 */
export async function saveDownloads(downloads: any[]): Promise<void> {
  await chrome.storage.local.set({ [DOWNLOADS_KEY]: downloads })
}

/**
 * 获取所有下载任务
 */
export async function getDownloads(): Promise<any[]> {
  const result = await chrome.storage.local.get(DOWNLOADS_KEY)
  return result[DOWNLOADS_KEY] || []
}
```

- [ ] **Step 5: 提交**

```bash
git add src/utils/
git commit -m "feat: add utility functions for sanitization, formatting, hashing, and storage"
```

---

### Task 4: Zustand 状态管理

**Files:**
- Create: `src/store/video-store.ts`
- Create: `src/store/download-store.ts`
- Create: `src/store/settings-store.ts`

- [ ] **Step 1: 实现视频状态管理**

```typescript
// src/store/video-store.ts

import { create } from 'zustand'
import type { DetectedVideo, VideoFilter } from '../types'

interface VideoState {
  videos: DetectedVideo[]
  filteredVideos: DetectedVideo[]
  isDetecting: boolean
  currentFilter: VideoFilter

  setVideos: (videos: DetectedVideo[]) => void
  addVideo: (video: DetectedVideo) => void
  clearVideos: () => void
  setDetecting: (isDetecting: boolean) => void
  setFilter: (filter: Partial<VideoFilter>) => void
  applyFilter: () => void
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  filteredVideos: [],
  isDetecting: false,
  currentFilter: {
    formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash'],
    minResolution: 'any',
    minSize: 'any',
    minDuration: 'any',
    sources: [],
    videoType: 'all',
    sortBy: 'detectedAt',
    sortOrder: 'desc',
  },

  setVideos: (videos) => {
    set({ videos })
    get().applyFilter()
  },

  addVideo: (video) => {
    const { videos } = get()
    // 去重
    if (videos.some((v) => v.id === video.id)) return
    set({ videos: [...videos, video] })
    get().applyFilter()
  },

  clearVideos: () => {
    set({ videos: [], filteredVideos: [] })
  },

  setDetecting: (isDetecting) => {
    set({ isDetecting })
  },

  setFilter: (filter) => {
    set((state) => ({
      currentFilter: { ...state.currentFilter, ...filter },
    }))
    get().applyFilter()
  },

  applyFilter: () => {
    const { videos, currentFilter } = get()
    let result = [...videos]

    // 格式过滤
    if (currentFilter.formats.length > 0) {
      result = result.filter((v) =>
        currentFilter.formats.includes(v.format)
      )
    }

    // 分辨率过滤
    const resolutionThresholds: Record<string, number> = {
      '4k': 2160,
      '1080p': 1080,
      '720p': 720,
      '480p': 480,
      '360p': 360,
    }
    if (
      currentFilter.minResolution !== 'any' &&
      resolutionThresholds[currentFilter.minResolution]
    ) {
      const threshold = resolutionThresholds[currentFilter.minResolution]
      result = result.filter(
        (v) => v.height && v.height >= threshold
      )
    }

    // 大小过滤
    const sizeThresholds: Record<string, number> = {
      '10mb': 10 * 1024 * 1024,
      '50mb': 50 * 1024 * 1024,
      '100mb': 100 * 1024 * 1024,
      '500mb': 500 * 1024 * 1024,
    }
    if (
      currentFilter.minSize !== 'any' &&
      sizeThresholds[currentFilter.minSize]
    ) {
      const threshold = sizeThresholds[currentFilter.minSize]
      result = result.filter((v) => v.size && v.size >= threshold)
    }

    // 时长过滤
    const durationThresholds: Record<string, number> = {
      '1min': 60,
      '5min': 300,
      '10min': 600,
      '30min': 1800,
    }
    if (
      currentFilter.minDuration !== 'any' &&
      durationThresholds[currentFilter.minDuration]
    ) {
      const threshold = durationThresholds[currentFilter.minDuration]
      result = result.filter(
        (v) => v.duration && v.duration >= threshold
      )
    }

    // 来源过滤
    if (currentFilter.sources.length > 0) {
      result = result.filter((v) =>
        currentFilter.sources.includes(v.domain)
      )
    }

    // 类型过滤
    if (currentFilter.videoType !== 'all') {
      const typeMap: Record<string, string[]> = {
        regular: ['mp4', 'mkv', 'flv', 'avi', 'rmvb', 'rm', 'webm', 'mov', 'ts'],
        streaming: ['hls', 'dash'],
        blob: ['blob'],
      }
      result = result.filter((v) =>
        typeMap[currentFilter.videoType]?.includes(v.format)
      )
    }

    // 排序
    const { sortBy, sortOrder } = currentFilter
    result.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'size':
          cmp = (a.size || 0) - (b.size || 0)
          break
        case 'resolution':
          cmp = (a.height || 0) - (b.height || 0)
          break
        case 'duration':
          cmp = (a.duration || 0) - (b.duration || 0)
          break
        case 'detectedAt':
        default:
          cmp = a.detectedAt - b.detectedAt
          break
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })

    set({ filteredVideos: result })
  },
}))
```

- [ ] **Step 2: 实现下载状态管理**

```typescript
// src/store/download-store.ts

import { create } from 'zustand'
import type { DownloadTask, DownloadStatus } from '../types'

interface DownloadState {
  tasks: DownloadTask[]

  addTask: (task: DownloadTask) => void
  updateTask: (id: string, update: Partial<DownloadTask>) => void
  updateProgress: (id: string, progress: number, speed: number, downloadedBytes: number) => void
  updateStatus: (id: string, status: DownloadStatus, error?: string) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  getTasksByStatus: (status: DownloadStatus) => DownloadTask[]
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    set((state) => ({ tasks: [...state.tasks, task] }))
  },

  updateTask: (id, update) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...update } : t
      ),
    }))
  },

  updateProgress: (id, progress, speed, downloadedBytes) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, progress, speed, downloadedBytes }
          : t
      ),
    }))
  },

  updateStatus: (id, status, error) => {
    const now = Date.now()
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== id) return t
        const update: Partial<DownloadTask> = { status }
        if (error) update.error = error
        if (status === 'downloading' && !t.startedAt) update.startedAt = now
        if (status === 'completed' || status === 'failed') update.completedAt = now
        return { ...t, ...update }
      }),
    }))
  },

  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }))
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status !== 'completed' && t.status !== 'failed'
      ),
    }))
  },

  getTasksByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status)
  },
}))
```

- [ ] **Step 3: 实现设置状态管理**

```typescript
// src/store/settings-store.ts

import { create } from 'zustand'
import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { getSettings, updateSettings } from '../utils/storage'

interface SettingsState {
  settings: AppSettings
  isLoaded: boolean

  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  resetSettings: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  isLoaded: false,

  loadSettings: async () => {
    const settings = await getSettings()
    set({ settings, isLoaded: true })
  },

  updateSetting: async (key, value) => {
    set((state) => {
      const newSettings = { ...state.settings, [key]: value }
      // 后台持久化（不阻塞 UI）
      updateSettings({ [key]: value })
      return { settings: newSettings }
    })
  },

  resetSettings: async () => {
    set({ settings: { ...DEFAULT_SETTINGS } })
    await updateSettings(DEFAULT_SETTINGS)
  },
}))
```

- [ ] **Step 4: 提交**

```bash
git add src/store/
git commit -m "feat: add Zustand stores for videos, downloads, and settings"
```

---

## 阶段 2：内容脚本 - 视频检测

### Task 5: Content Script - 网络请求拦截器

**Files:**
- Create: `src/content/network-interceptor.ts`

- [ ] **Step 1: 实现 XHR/Fetch hook 拦截**

```typescript
// src/content/network-interceptor.ts

import type { DetectedVideo, VideoFormat } from '../types'
import { VIDEO_EXTENSIONS, HLS_CONTENT_TYPES, DASH_CONTENT_TYPES } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type InterceptorCallback = (video: DetectedVideo) => void

/**
 * 从 URL 中提取视频格式
 */
function detectFormatFromUrl(url: string): VideoFormat | null {
  const lower = url.toLowerCase().split('?')[0].split('#')[0]

  // HLS 检测
  if (lower.includes('.m3u8')) return 'hls'
  // DASH 检测
  if (lower.includes('.mpd')) return 'dash'

  // 常规视频格式检测
  for (const [ext, format] of Object.entries(VIDEO_EXTENSIONS)) {
    if (lower.endsWith(ext)) return format
  }

  return null
}

/**
 * 从 Content-Type 中检测视频格式
 */
function detectFormatFromContentType(
  contentType: string
): VideoFormat | null {
  const lower = contentType.toLowerCase()

  for (const hlsType of HLS_CONTENT_TYPES) {
    if (lower.includes(hlsType)) return 'hls'
  }
  for (const dashType of DASH_CONTENT_TYPES) {
    if (lower.includes(dashType)) return 'dash'
  }

  // 通用视频 Content-Type
  if (
    lower.includes('video/') ||
    lower.includes('application/octet-stream')
  ) {
    // 尝试从 Content-Type 参数中提取
    return null // 返回 null，让 URL 检测决定格式
  }

  return null
}

/**
 * 判断是否为视频相关请求
 */
function isVideoRequest(url: string, contentType?: string): boolean {
  return detectFormatFromUrl(url) !== null ||
    (contentType ? detectFormatFromContentType(contentType) !== null : false)
}

/**
 * Hook XHR 请求以拦截视频 URL
 */
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
            // HEADERS_RECEIVED - 可以获取 Content-Type
            const contentType =
              xhr.getResponseHeader('content-type') || ''
            if (
              format === 'hls' &&
              !HLS_CONTENT_TYPES.some((t) =>
                contentType.toLowerCase().includes(t)
              )
            ) {
              return // URL 看起来像 m3u8 但 Content-Type 不匹配，跳过
            }
            reportVideo(url, format, contentType, callback)
          }
        })
      }
    }

    return originalSend.apply(this, args) as any
  }
}

/**
 * Hook fetch 请求以拦截视频 URL
 */
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

/**
 * 上报检测到的视频
 */
let reportedUrls = new Set<string>()

async function reportVideo(
  url: string,
  format: VideoFormat,
  contentType: string,
  callback: InterceptorCallback
) {
  // 去重（同一 URL 只上报一次）
  if (reportedUrls.has(url)) return
  reportedUrls.add(url)

  // 过滤掉明显不是视频的请求（小于 1KB 或明显是页面片段）
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

/**
 * 启动网络拦截
 */
export function startNetworkInterception(callback: InterceptorCallback): void {
  hookXHR(callback)
  hookFetch(callback)
}

/**
 * 停止网络拦截并清理
 */
export function stopNetworkInterception(): void {
  reportedUrls.clear()
}
```

- [ ] **Step 2: 提交**

```bash
git add src/content/network-interceptor.ts
git commit -m "feat: add network interceptor for XHR/Fetch video detection"
```

---

### Task 6: Content Script - DOM 观察器

**Files:**
- Create: `src/content/dom-observer.ts`

- [ ] **Step 1: 实现 DOM 元素监听**

```typescript
// src/content/dom-observer.ts

import type { DetectedVideo, VideoFormat } from '../types'
import { VIDEO_EXTENSIONS } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type ObserverCallback = (video: DetectedVideo) => void

let observer: MutationObserver | null = null
let reportedElements = new WeakSet<Element>()

/**
 * 从 URL 提取视频格式
 */
function getFormatFromSrc(src: string): VideoFormat | null {
  const lower = src.toLowerCase().split('?')[0].split('#')[0]
  if (lower.includes('.m3u8')) return 'hls'
  if (lower.includes('.mpd')) return 'dash'
  for (const [ext, format] of Object.entries(VIDEO_EXTENSIONS)) {
    if (lower.endsWith(ext)) return format
  }
  return null
}

/**
 * 分析 video/source 元素提取视频信息
 */
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

  // 尝试获取 video 元素属性
  if (element instanceof HTMLVideoElement) {
    video.width = element.videoWidth || undefined
    video.height = element.videoHeight || undefined
    video.duration = element.duration && isFinite(element.duration) ? element.duration : undefined
  }

  callback(video)
}

/**
 * 扫描页面中已有的 video/source 元素
 */
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

/**
 * 启动 DOM 观察器
 */
export function startDomObserver(callback: ObserverCallback): void {
  // 先扫描已有元素
  scanExistingElements(callback)

  // 监听新增元素
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          // 检查新增节点本身
          if (
            node instanceof HTMLVideoElement ||
            node instanceof HTMLSourceElement
          ) {
            analyzeMediaElement(node, callback)
          }

          // 检查子节点
          const videos = node.querySelectorAll('video, source')
          for (const el of videos) {
            analyzeMediaElement(
              el as HTMLVideoElement | HTMLSourceElement,
              callback
            )
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

/**
 * 停止 DOM 观察器
 */
export function stopDomObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/content/dom-observer.ts
git commit -m "feat: add DOM observer for video/source element detection"
```

---

### Task 7: Content Script - HLS 解析器

**Files:**
- Create: `src/content/hls-parser.ts`

- [ ] **Step 1: 实现 M3U8 解析**

```typescript
// src/content/hls-parser.ts

import type { DetectedVideo, VideoEncryption } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type ParserCallback = (videos: DetectedVideo[]) => void

/**
 * M3U8 标签类型
 */
interface M3U8Tag {
  name: string
  value: string
  attributes?: Record<string, string>
}

/**
 * HLS 流信息
 */
interface HLSStream {
  bandwidth: number
  resolution?: { width: number; height: number }
  codecs?: string
  url: string
}

/**
 * 加密信息
 */
interface HLSEncryption {
  method: string
  keyUrl?: string
  iv?: string
}

/**
 * 解析 M3U8 文本内容
 */
function parseM3U8(content: string): {
  isMaster: boolean
  streams: HLSStream[]
  segments: string[]
  encryption?: HLSEncryption
} {
  const lines = content.split('\n').map((l) => l.trim())
  const tags: M3U8Tag[] = []

  for (const line of lines) {
    if (line.startsWith('#')) {
      const colonIndex = line.indexOf(':')
      if (colonIndex !== -1) {
        const name = line.substring(1, colonIndex)
        const value = line.substring(colonIndex + 1)
        const tag: M3U8Tag = { name, value }

        // 解析属性列表
        if (value.includes('=')) {
          tag.attributes = {}
          const attrs = value.match(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)
          if (attrs) {
            for (const attr of attrs) {
              const eqIndex = attr.indexOf('=')
              const key = attr.substring(0, eqIndex)
              let val = attr.substring(eqIndex + 1)
              val = val.replace(/^"|"$/g, '')
              tag.attributes[key] = val
            }
          }
        }

        tags.push(tag)
      }
    }
  }

  // 检测是否为 master playlist
  const isMaster = tags.some(
    (t) => t.name === 'EXT-X-STREAM-INF'
  )

  // 检测加密
  let encryption: HLSEncryption | undefined
  const keyTag = tags.find((t) => t.name === 'EXT-X-KEY')
  if (keyTag?.attributes) {
    encryption = {
      method: keyTag.attributes.METHOD || '',
      keyUrl: keyTag.attributes.URI,
      iv: keyTag.attributes.IV,
    }
  }

  if (isMaster) {
    // 解析 master playlist
    const streams: HLSStream[] = []
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i]
      if (tag.name === 'EXT-X-STREAM-INF' && tag.attributes) {
        // 下一个非标签行是 URL
        let url = ''
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].startsWith('#')) {
            url = lines[j].trim()
            break
          }
        }

        const bandwidth = parseInt(tag.attributes.BANDWIDTH || '0', 10)
        let resolution: { width: number; height: number } | undefined

        if (tag.attributes.RESOLUTION) {
          const [width, height] = tag.attributes.RESOLUTION
            .split('x')
            .map(Number)
          resolution = { width, height }
        }

        streams.push({
          bandwidth,
          resolution,
          codecs: tag.attributes.CODECS,
          url,
        })
      }
    }
    return { isMaster: true, streams, segments: [], encryption }
  } else {
    // 解析 media playlist - 提取 ts 分片 URL
    const segments: string[] = []
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        segments.push(line)
      }
    }
    return { isMaster: false, streams: [], segments, encryption }
  }
}

/**
 * 获取 M3U8 的基础 URL（用于解析相对路径）
 */
function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

/**
 * 解析 HLS 视频信息并生成 DetectedVideo 列表
 */
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
      // Master playlist：为每个清晰度生成一条记录
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
      // Media playlist：作为单条 HLS 视频记录
      const resolvedSegments = parsed.segments.map((s) =>
        resolveUrl(m3u8Url, s)
      )

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
```

- [ ] **Step 2: 提交**

```bash
git add src/content/hls-parser.ts
git commit -m "feat: add HLS m3u8 parser with master/media playlist support"
```

---

### Task 8: Content Script - DASH 解析器

**Files:**
- Create: `src/content/dash-parser.ts`

- [ ] **Step 1: 实现 MPD 解析**

```typescript
// src/content/dash-parser.ts

import type { DetectedVideo } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type ParserCallback = (videos: DetectedVideo[]) => void

/**
 * DASH AdaptationSet 信息
 */
interface DASHAdaptationSet {
  mimeType: string
  codecs?: string
  bandwidth?: number
  width?: number
  height?: number
  segmentTemplate?: {
    media?: string
    initialization?: string
    timescale?: number
    startNumber?: number
  }
  baseURL?: string
}

/**
 * 解析 MPD XML
 */
function parseMPD(xml: string): {
  adaptationSets: DASHAdaptationSet[]
  minBufferTime?: string
} {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')

  // 检查解析错误
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    console.error('[VideoDownloader] MPD parse error:', parseError.textContent)
    return { adaptationSets: [] }
  }

  const mpd = doc.querySelector('MPD')
  if (!mpd) return { adaptationSets: [] }

  const adaptationSets: DASHAdaptationSet[] = []

  const period = mpd.querySelector('Period')
  if (!period) return { adaptationSets: [] }

  const sets = period.querySelectorAll('AdaptationSet')
  for (const set of sets) {
    const adaptation: DASHAdaptationSet = {
      mimeType: set.getAttribute('mimeType') || '',
      codecs: set.getAttribute('codecs') || undefined,
    }

    // 从 Representation 提取具体信息
    const representations = set.querySelectorAll('Representation')
    for (const rep of representations) {
      const repInfo: DASHAdaptationSet = {
        ...adaptation,
        bandwidth: parseInt(rep.getAttribute('bandwidth') || '0', 10),
        width: rep.getAttribute('width')
          ? parseInt(rep.getAttribute('width')!, 10)
          : undefined,
        height: rep.getAttribute('height')
          ? parseInt(rep.getAttribute('height')!, 10)
          : undefined,
      }

      // 提取 SegmentTemplate
      const segmentTemplate = rep.querySelector(':scope > SegmentTemplate') ||
        set.querySelector('SegmentTemplate')
      if (segmentTemplate) {
        repInfo.segmentTemplate = {
          media: segmentTemplate.getAttribute('media') || undefined,
          initialization: segmentTemplate.getAttribute('initialization') || undefined,
          timescale: segmentTemplate.getAttribute('timescale')
            ? parseInt(segmentTemplate.getAttribute('timescale')!, 10)
            : undefined,
          startNumber: segmentTemplate.getAttribute('startNumber')
            ? parseInt(segmentTemplate.getAttribute('startNumber')!, 10)
            : undefined,
        }
      }

      // 提取 BaseURL
      const baseUrl = rep.querySelector(':scope > BaseURL') ||
        set.querySelector('BaseURL')
      if (baseUrl?.textContent) {
        repInfo.baseURL = baseUrl.textContent
      }

      // 只记录视频类型的 AdaptationSet
      if (repInfo.mimeType?.startsWith('video/')) {
        adaptationSets.push(repInfo)
      }
    }
  }

  return { adaptationSets }
}

/**
 * 解析 DASH MPD 并生成 DetectedVideo 列表
 */
export async function parseDASH(
  mpdUrl: string,
  pageUrl: string,
  callback: ParserCallback
): Promise<void> {
  try {
    const response = await fetch(mpdUrl)
    if (!response.ok) return

    const xml = await response.text()
    const parsed = parseMPD(xml)

    if (parsed.adaptationSets.length === 0) return

    const videos: DetectedVideo[] = []
    const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf('/') + 1)

    // 按分辨率分组，取每个清晰度的最高码率
    const bestByResolution = new Map<string, DASHAdaptationSet>()

    for (const set of parsed.adaptationSets) {
      const resKey = set.height ? `${set.height}p` : 'unknown'
      const existing = bestByResolution.get(resKey)
      if (!existing || (set.bandwidth && existing.bandwidth && set.bandwidth > existing.bandwidth)) {
        bestByResolution.set(resKey, set)
      }
    }

    for (const [quality, set] of bestByResolution) {
      const id = await generateVideoFingerprint(mpdUrl, quality)

      videos.push({
        id,
        url: mpdUrl,
        title: '',
        format: 'dash',
        mimeType: set.mimeType || 'application/dash+xml',
        size: undefined,
        width: set.width,
        height: set.height,
        bitrate: set.bandwidth,
        source: 'network',
        pageUrl,
        domain: new URL(pageUrl).hostname,
        detectedAt: Date.now(),
      })
    }

    callback(videos)
  } catch (error) {
    console.error('[VideoDownloader] DASH parse error:', error)
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/content/dash-parser.ts
git commit -m "feat: add DASH MPD parser with adaptation set extraction"
```

---

### Task 9: Content Script - Blob 处理器

**Files:**
- Create: `src/content/blob-handler.ts`

- [ ] **Step 1: 实现 Blob URL 视频检测**

```typescript
// src/content/blob-handler.ts

import type { DetectedVideo } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type BlobCallback = (video: DetectedVideo) => void

let originalCreateObjectURL: typeof URL.createObjectURL | null = null

/**
 * Hook URL.createObjectURL 以捕获 Blob 视频
 */
export function hookBlobCreation(callback: BlobCallback): void {
  if (originalCreateObjectURL) return // 避免重复 hook

  originalCreateObjectURL = URL.createObjectURL

  URL.createObjectURL = function (blob: Blob) {
    const blobUrl = originalCreateObjectURL!.call(URL, blob)

    if (blob instanceof Blob && blob.type.startsWith('video/')) {
      handleBlobVideo(blobUrl, blob.type, callback)
    }

    return blobUrl
  }
}

/**
 * 处理检测到的 Blob 视频
 */
async function handleBlobVideo(
  blobUrl: string,
  mimeType: string,
  callback: BlobCallback
): Promise<void> {
  const id = await generateVideoFingerprint(blobUrl, 'blob')

  const video: DetectedVideo = {
    id,
    url: blobUrl,
    title: '',
    format: 'blob',
    mimeType,
    size: undefined, // Blob 大小可通过 blob.size 获取，但此时无引用
    source: 'blob',
    pageUrl: window.location.href,
    domain: window.location.hostname,
    detectedAt: Date.now(),
  }

  callback(video)
}

/**
 * 恢复原始 createObjectURL
 */
export function unhookBlobCreation(): void {
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL
    originalCreateObjectURL = null
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/content/blob-handler.ts
git commit -m "feat: add Blob URL video handler"
```

---

### Task 10: Content Script - 智能命名

**Files:**
- Create: `src/content/name-detector.ts`

- [ ] **Step 1: 实现智能命名提取**

```typescript
// src/content/name-detector.ts

import { isGarbled, sanitizeName } from '../utils/sanitize'

/**
 * 从页面中智能提取视频名称
 */
export function detectVideoName(): string {
  // 优先级 1: 页面 <title> 标签
  const title = extractTitle()
  if (title && !isGarbled(title)) return title

  // 优先级 2: Open Graph 标签
  const ogTitle = extractOgTitle()
  if (ogTitle && !isGarbled(ogTitle)) return ogTitle

  // 优先级 3: <h1> 标签
  const h1 = extractH1()
  if (h1 && !isGarbled(h1)) return h1

  // 优先级 4: <video> 元素附近文本
  const nearbyText = extractNearbyVideoText()
  if (nearbyText && !isGarbled(nearbyText)) return nearbyText

  // 优先级 5: URL 路径
  const urlName = extractFromUrl()
  if (urlName && !isGarbled(urlName)) return urlName

  // 优先级 6: 兜底
  return generateFallbackName()
}

/**
 * 提取页面 title
 */
function extractTitle(): string {
  return document.title?.trim() || ''
}

/**
 * 提取 Open Graph 标题
 */
function extractOgTitle(): string {
  // og:video:title 优先于 og:title
  const ogVideoTitle = document.querySelector(
    'meta[property="og:video:title"]'
  )
  if (ogVideoTitle?.getAttribute('content')?.trim()) {
    return ogVideoTitle.getAttribute('content')!.trim()
  }

  const ogTitle = document.querySelector(
    'meta[property="og:title"]'
  )
  return ogTitle?.getAttribute('content')?.trim() || ''
}

/**
 * 提取 h1 标签
 */
function extractH1(): string {
  const h1 = document.querySelector('h1')
  return h1?.textContent?.trim() || ''
}

/**
 * 提取 <video> 元素附近的文本
 */
function extractNearbyVideoText(): string {
  const video = document.querySelector('video')
  if (!video) return ''

  // 查找同层级的文本
  const parent = video.parentElement
  if (!parent) return ''

  // 查找标题元素
  const heading = parent.querySelector(
    'h1, h2, h3, .title, .video-title, [class*="title"]'
  )
  if (heading?.textContent?.trim()) {
    return heading.textContent.trim()
  }

  // 查找父元素的 title 属性
  if (parent.getAttribute('title')?.trim()) {
    return parent.getAttribute('title')!.trim()
  }

  // 查找 aria-label
  if (video.getAttribute('aria-label')?.trim()) {
    return video.getAttribute('aria-label')!.trim()
  }

  return ''
}

/**
 * 从 URL 路径中提取名称
 */
function extractFromUrl(): string {
  const pathname = window.location.pathname
  // 去除扩展名，取最后一段有意义的路径
  const segments = pathname
    .split('/')
    .filter((s) => s && s !== '.')

  if (segments.length === 0) return ''

  // 取最后一段
  let last = segments[segments.length - 1]
  // 去除查询参数和 hash
  last = last.split('?')[0].split('#')[0]
  // 去除文件扩展名
  last = last.replace(/\.\w+$/, '')
  // URL 解码
  try {
    last = decodeURIComponent(last)
  } catch {
    // ignore
  }
  // 将连字符和下划线转为空格
  last = last.replace(/[-_]+/g, ' ')

  return last
}

/**
 * 生成兜底名称
 */
function generateFallbackName(): string {
  const domain = window.location.hostname.replace('www.', '')
  const date = new Date()
  const timestamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('')

  return sanitizeName(`${domain}_${timestamp}`)
}

/**
 * 为视频生成最终文件名
 */
export function buildVideoFileName(
  detectedTitle: string,
  format: string,
  template: string,
  extraVars?: Record<string, string>
): string {
  const vars: Record<string, string> = {
    name: detectedTitle || generateFallbackName(),
    domain: window.location.hostname.replace('www.', ''),
    date: new Date().toISOString().split('T')[0],
    format: format === 'hls' ? 'mp4' : format === 'dash' ? 'mp4' : format,
    ...extraVars,
  }

  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }

  return sanitizeName(result)
}
```

- [ ] **Step 2: 提交**

```bash
git add src/content/name-detector.ts
git commit -m "feat: add smart video name detection with 6-level priority fallback"
```

---

### Task 11: Content Script - 主入口

**Files:**
- Create: `src/content/index.ts`

- [ ] **Step 1: 编写 Content Script 主入口，串联所有检测器**

```typescript
// src/content/index.ts

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

/**
 * 检查 URL 是否匹配黑名单
 */
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
          // url 类型：包含匹配
          return url.includes(rule.pattern)
        }
      } catch {
        return false
      }
    })
}

/**
 * 获取页面视频名称（带缓存）
 */
function getPageName(): string {
  if (!nameCache) {
    nameCache = detectVideoName()
  }
  return nameCache
}

/**
 * 处理检测到的视频
 */
function handleDetectedVideo(video: DetectedVideo): void {
  // 去重
  if (detectedVideos.has(video.id)) return

  // 获取黑名单（从存储中读取）
  chrome.storage.local.get('app-settings', (result) => {
    const settings = result['app-settings']
    const blacklist = settings?.blacklist || []

    if (isBlacklisted(video.url, blacklist)) {
      console.log(`[VideoDownloader] Filtered (blacklisted): ${video.url}`)
      return
    }

    // 设置智能名称
    video.title = getPageName()

    detectedVideos.set(video.id, video)

    // 如果是 HLS 或 DASH，进一步解析
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

/**
 * 将检测到的视频发送给 Background Service Worker
 */
function sendVideosToBackground(): void {
  const videos = Array.from(detectedVideos.values())
  chrome.runtime.sendMessage({
    type: 'VIDEO_DETECTED',
    payload: {
      pageUrl: window.location.href,
      videos,
    },
  }).catch(() => {
    // 扩展可能未就绪，忽略
  })
}

/**
 * 初始化所有检测器
 */
function init(): void {
  // 网络拦截
  startNetworkInterception(handleDetectedVideo)

  // DOM 观察
  startDomObserver(handleDetectedVideo)

  // Blob 检测
  hookBlobCreation(handleDetectedVideo)

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    stopNetworkInterception()
    stopDomObserver()
    unhookBlobCreation()
  })

  console.log('[VideoDownloader] Content script initialized')
}

// 启动
init()
```

- [ ] **Step 2: 验证 Content Script 编译**

Run:
```bash
pnpm dev
```

Expected: Plasmo 编译成功，Content Script 被注入到页面。

- [ ] **Step 3: 提交**

```bash
git add src/content/
git commit -m "feat: add content script main entry integrating all detectors"
```

---

## 阶段 3：Background Service Worker

### Task 12: Background - 设置管理

**Files:**
- Create: `src/background/settings.ts`

- [ ] **Step 1: 实现设置管理服务**

```typescript
// src/background/settings.ts

import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { getSettings, updateSettings } from '../utils/storage'

/**
 * 获取设置（合并默认值）
 */
export async function getFullSettings(): Promise<AppSettings> {
  return await getSettings()
}

/**
 * 更新设置
 */
export async function patchSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  await updateSettings(partial)
  return await getSettings()
}

/**
 * 重置为默认设置
 */
export async function resetToDefaults(): Promise<AppSettings> {
  await updateSettings(DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS }
}

/**
 * 初始化默认设置（扩展安装时调用）
 */
export async function initDefaultSettings(): Promise<void> {
  const current = await getSettings()
  // 仅在首次安装时写入默认值
  if (!current || Object.keys(current).length === 0) {
    await chrome.storage.local.set({
      'app-settings': DEFAULT_SETTINGS,
    })
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/background/settings.ts
git commit -m "feat: add background settings management service"
```

---

### Task 13: Background - 下载管理器

**Files:**
- Create: `src/background/download-manager.ts`

- [ ] **Step 1: 实现下载队列与并发控制**

```typescript
// src/background/download-manager.ts

import type {
  DetectedVideo,
  DownloadTask,
  DownloadSettings,
  DownloaderType,
} from '../types'
import { getFullSettings } from './settings'
import { buildVideoFileName } from '../content/name-detector'
import { saveDownloads, getDownloads } from '../utils/storage'

// 当前活跃的下载任务
let activeDownloads: Map<
  string,
  { abortController?: AbortController }
> = new Map()
let downloadQueue: DownloadTask[] = []
let isProcessing = false

/**
 * 创建下载任务
 */
export async function createDownloadTask(
  video: DetectedVideo,
  downloader: DownloaderType
): Promise<DownloadTask> {
  const settings = await getFullSettings()
  const settings_ds = settings.downloadSettings

  // 生成文件名
  let fileName: string
  if (video.title && downloader === 'chrome') {
    // 内置下载器使用智能命名
    const basePath = settings.saveByDomain
      ? `${video.domain}/`
      : ''

    fileName = `${basePath}${buildVideoFileName(
      video.title,
      video.format,
      settings.namingTemplate,
      {
        resolution: video.height ? `${video.height}p` : '',
      }
    )}`
  } else {
    // 外部下载器传递原始 URL
    fileName = video.url.split('/').pop() || 'video.mp4'
  }

  const task: DownloadTask = {
    id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    video,
    status: 'pending',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: video.size || 0,
    downloader,
  }

  downloadQueue.push(task)
  await persistTasks()

  // 通知 UI
  broadcastDownloadUpdate(task)

  // 开始处理队列
  processQueue()

  return task
}

/**
 * 处理下载队列（并发控制）
 */
async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  while (true) {
    const settings = await getFullSettings()
    const { maxConcurrent } = settings.downloadSettings

    // 获取活跃下载数
    const activeCount = activeDownloads.size

    if (activeCount >= maxConcurrent) break

    // 找到下一个待处理的任务
    const next = downloadQueue.find((t) => t.status === 'pending')
    if (!next) break

    // 更新状态
    updateTaskStatus(next.id, 'downloading')

    // 根据下载器类型分发
    switch (next.downloader) {
      case 'chrome':
        await downloadWithChrome(next, settings.downloadSettings)
        break
      case 'aria2':
        await downloadWithAria2(next)
        break
      case 'idm':
        await downloadWithIDM(next)
        break
      case 'motrix':
        await downloadWithMotrix(next)
        break
      default:
        await downloadWithChrome(next, settings.downloadSettings)
    }
  }

  isProcessing = false
}

/**
 * 使用 Chrome Downloads API 下载
 */
async function downloadWithChrome(
  task: DownloadTask,
  settings: DownloadSettings
): Promise<void> {
  const abortController = new AbortController()
  activeDownloads.set(task.id, { abortController })

  try {
    const downloadId = await chrome.downloads.download({
      url: task.video.url,
      filename: task.filePath || undefined,
      conflictAction: 'uniquify',
    })

    // 监听下载进度
    setupDownloadProgress(task.id, downloadId)

    // 监听下载完成
    chrome.downloads.onChanged.addListener(function listener(delta) {
      if (delta.id !== downloadId) return

      if (delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener)
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'completed')
        processQueue()
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener)
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'failed', delta.error?.current)
        processQueue()
      }
    })
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

/**
 * 设置 Chrome 下载进度监听
 */
function setupDownloadProgress(
  taskId: string,
  downloadId: number
): void {
  // Chrome Downloads API 不直接提供进度
  // 需要通过查询状态获取
  const interval = setInterval(async () => {
    if (!activeDownloads.has(taskId)) {
      clearInterval(interval)
      return
    }

    try {
      const results = await chrome.downloads.search({ id: downloadId })
      if (results.length > 0) {
        const dl = results[0]
        const progress =
          dl.totalBytes > 0
            ? (dl.bytesReceived / dl.totalBytes) * 100
            : 0

        updateTaskProgress(
          taskId,
          progress,
          0, // Chrome API 不提供速度信息
          dl.bytesReceived
        )
      }
    } catch {
      clearInterval(interval)
    }
  }, 1000)
}

/**
 * 使用 aria2 RPC 下载
 */
async function downloadWithAria2(task: DownloadTask): Promise<void> {
  const settings = await getFullSettings()
  const config = settings.externalDownloaderConfig

  try {
    const response = await fetch(config.aria2RpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: task.id,
        method: 'aria2.addUri',
        params: [
          [task.video.url],
          {
            dir: settings.baseSaveDirectory || undefined,
            out: task.video.title
              ? `${task.video.title}.${task.video.format === 'hls' || task.video.format === 'dash' ? 'mp4' : task.video.format}`
              : undefined,
          },
        ],
      }),
    })

    const result = await response.json()
    if (result.error) {
      updateTaskStatus(task.id, 'failed', result.error.message)
    } else {
      // aria2 下载是异步的，标记为已完成（实际由 aria2 管理）
      updateTaskStatus(task.id, 'completed')
    }

    activeDownloads.delete(task.id)
    processQueue()
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

/**
 * 使用 IDM 下载
 */
async function downloadWithIDM(task: DownloadTask): Promise<void> {
  const settings = await getFullSettings()
  const config = settings.externalDownloaderConfig

  try {
    // IDM 使用 idm:// 协议唤起
    const idmUrl = `idm://${
      settings.baseSaveDirectory || ''
    }&${encodeURIComponent(task.video.url)}&${encodeURIComponent(
      task.video.title || 'video'
    )}`

    // 通过 chrome.tabs 发送请求
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: idmUrl })
    }

    updateTaskStatus(task.id, 'completed')
    activeDownloads.delete(task.id)
    processQueue()
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

/**
 * 使用 Motrix 下载（兼容 aria2 RPC）
 */
async function downloadWithMotrix(task: DownloadTask): Promise<void> {
  // Motrix 默认使用 aria2 RPC，与 aria2 相同
  return downloadWithAria2(task)
}

/**
 * 暂停下载
 */
export async function pauseDownload(taskId: string): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  if (task.downloader === 'chrome' && task.status === 'downloading') {
    // Chrome Downloads API 支持暂停
    // 需要记录 downloadId，这里简化处理
  }

  updateTaskStatus(taskId, 'paused')
}

/**
 * 取消下载
 */
export async function cancelDownload(taskId: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
  }
  activeDownloads.delete(taskId)

  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.status = 'failed'
    task.error = '已取消'
  }

  await persistTasks()
  broadcastDownloadUpdate(task!)
}

/**
 * 更新任务状态
 */
function updateTaskStatus(
  taskId: string,
  status: DownloadTask['status'],
  error?: string
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.status = status
  if (error) task.error = error
  if (status === 'completed' || status === 'failed') {
    task.completedAt = Date.now()
  }

  broadcastDownloadUpdate(task)
  persistTasks()
}

/**
 * 更新任务进度
 */
function updateTaskProgress(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.progress = progress
  task.speed = speed
  task.downloadedBytes = downloadedBytes

  broadcastDownloadUpdate(task)
}

/**
 * 广播下载状态更新给所有 UI
 */
function broadcastDownloadUpdate(task: DownloadTask): void {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    payload: task,
  }).catch(() => {
    // 无接收者时忽略
  })
}

/**
 * 持久化下载任务
 */
async function persistTasks(): Promise<void> {
  await saveDownloads(downloadQueue)
}

/**
 * 获取所有下载任务
 */
export async function getAllDownloadTasks(): Promise<DownloadTask[]> {
  downloadQueue = await getDownloads()
  return downloadQueue
}

/**
 * 获取下载设置
 */
export async function getDownloadSettings(): Promise<DownloadSettings> {
  const settings = await getFullSettings()
  return settings.downloadSettings
}
```

- [ ] **Step 2: 提交**

```bash
git add src/background/download-manager.ts
git commit -m "feat: add download manager with queue, concurrency, and multi-downloader support"
```

---

### Task 14: Background - 主入口

**Files:**
- Create: `src/background/index.ts`

- [ ] **Step 1: 编写 Background 主入口，消息路由**

```typescript
// src/background/index.ts

import { initDefaultSettings, getFullSettings, patchSettings, resetToDefaults } from './settings'
import {
  createDownloadTask,
  pauseDownload,
  cancelDownload,
  getAllDownloadTasks,
} from './download-manager'
import type { DetectedVideo, DownloaderType, ExtensionMessage } from '../types'
import { saveVideos, getVideos, clearVideos } from '../utils/storage'

// 页面视频缓存
const pageVideos = new Map<string, DetectedVideo[]>()

/**
 * 初始化扩展
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[VideoDownloader] Extension installed')
  await initDefaultSettings()
  setupContextMenus()
})

/**
 * 设置右键菜单
 */
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

/**
 * 处理右键菜单点击
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  if (info.menuItemId === 'detect-videos') {
    // 向当前页面发送消息要求检测
    chrome.tabs.sendMessage(tab.id, {
      type: 'DETECT_NOW',
    }).catch(() => {})
  } else if (info.menuItemId === 'download-video' && info.srcUrl) {
    // 直接下载视频元素
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

/**
 * 处理来自 Content Script 和 UI 的消息
 */
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[VideoDownloader] Message error:', error)
        sendResponse({ error: error.message })
      })
    return true // 保持消息通道开放以支持异步
  }
)

/**
 * 消息路由处理
 */
async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  switch (message.type) {
    // ===== 视频检测 =====
    case 'VIDEO_DETECTED': {
      const { pageUrl, videos } = message.payload
      pageVideos.set(pageUrl, videos)
      await saveVideos(pageUrl, videos)
      // 广播给所有 UI
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
      // 返回所有页面的视频
      return { videos: Array.from(pageVideos.values()).flat() }
    }

    // ===== 下载管理 =====
    case 'START_DOWNLOAD': {
      const { video, downloader } = message.payload
      const task = await createDownloadTask(
        video,
        downloader || 'chrome'
      )
      return { task }
    }

    case 'PAUSE_DOWNLOAD': {
      const { taskId } = message.payload
      await pauseDownload(taskId)
      return { success: true }
    }

    case 'CANCEL_DOWNLOAD': {
      const { taskId } = message.payload
      await cancelDownload(taskId)
      return { success: true }
    }

    case 'GET_DOWNLOADS': {
      const tasks = await getAllDownloadTasks()
      return { tasks }
    }

    // ===== 设置 =====
    case 'GET_SETTINGS': {
      const settings = await getFullSettings()
      return { settings }
    }

    case 'UPDATE_SETTINGS': {
      const updated = await patchSettings(message.payload)
      return { settings: updated }
    }

    default:
      console.warn('[VideoDownloader] Unknown message type:', message.type)
      return { error: 'Unknown message type' }
  }
}

/**
 * 打开 SidePanel
 */
chrome.action.onClicked.addListener(async (tab) => {
  // 如果已经打开了 SidePanel，关闭它；否则打开
  try {
    await chrome.sidePanel.open({ tabId: tab!.id! })
  } catch {
    // fallback: 打开 popup
  }
})

console.log('[VideoDownloader] Background service worker started')
```

- [ ] **Step 2: 提交**

```bash
git add src/background/index.ts
git commit -m "feat: add background service worker with message routing and context menus"
```

---

## 阶段 4：UI 层

### Task 15: Popup 页面

**Files:**
- Create: `src/popup/index.tsx`
- Create: `src/popup/components/VideoItem.tsx`
- Create: `src/popup/components/VideoList.tsx`

- [ ] **Step 1: 实现 VideoItem 组件**

```tsx
// src/popup/components/VideoItem.tsx

import React from 'react'
import { Button, Space, Tag, Typography } from 'antd'
import {
  PlayCircleOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { formatFileSize, formatDuration, getResolutionLabel } from '../../utils/format'

const { Text } = Typography

interface VideoItemProps {
  video: DetectedVideo
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
}

const formatColors: Record<string, string> = {
  mp4: 'blue',
  mkv: 'green',
  webm: 'cyan',
  flv: 'orange',
  hls: 'purple',
  dash: 'magenta',
  blob: 'default',
}

export const VideoItem: React.FC<VideoItemProps> = ({
  video,
  onPreview,
  onDownload,
}) => {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text
            strong
            ellipsis
            style={{ display: 'block', marginBottom: 4 }}
          >
            {video.title || '未命名视频'}
          </Text>
          <Space size={4} wrap>
            <Tag
              color={formatColors[video.format] || 'default'}
              style={{ margin: 0 }}
            >
              {video.format.toUpperCase()}
            </Tag>
            {video.height && (
              <Tag style={{ margin: 0 }}>
                {getResolutionLabel(video.width, video.height)}
              </Tag>
            )}
            {video.size && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatFileSize(video.size)}
              </Text>
            )}
            {video.duration && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatDuration(video.duration)}
              </Text>
            )}
          </Space>
        </div>
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => onPreview(video)}
          />
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => onDownload(video)}
          />
        </Space>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 实现 VideoList 组件**

```tsx
// src/popup/components/VideoList.tsx

import React from 'react'
import { Empty, Spin, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { VideoItem } from './VideoItem'

interface VideoListProps {
  videos: DetectedVideo[]
  isDetecting: boolean
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
  onDownloadAll: () => void
}

export const VideoList: React.FC<VideoListProps> = ({
  videos,
  isDetecting,
  onPreview,
  onDownload,
  onDownloadAll,
}) => {
  if (isDetecting && videos.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin tip="正在检测视频..." />
      </div>
    )
  }

  if (videos.length === 0) {
    return <Empty description="未检测到视频" />
  }

  return (
    <div>
      {videos.map((video) => (
        <VideoItem
          key={video.id}
          video={video}
          onPreview={onPreview}
          onDownload={onDownload}
        />
      ))}
      {videos.length > 1 && (
        <div style={{ padding: '8px 12px', textAlign: 'center' }}>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={onDownloadAll}
          >
            全部下载
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 实现 Popup 主页面**

```tsx
// src/popup/index.tsx

import React, { useEffect, useState, useCallback } from 'react'
import { ConfigProvider, theme, Typography, Space, Button } from 'antd'
import { SettingOutlined, AppstoreOutlined } from '@ant-design/icons'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { VideoList } from './components/VideoList'
import type { DetectedVideo, ExtensionMessage } from '../types'

const { Title, Text } = Typography

function IndexPopup() {
  const { filteredVideos, isDetecting, setVideos } = useVideoStore()
  const { settings, loadSettings } = useSettingsStore()
  const [currentTab, setCurrentTab] = useState<string>('')

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // 获取当前标签页信息
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setCurrentTab(tabs[0].url)
        // 从 background 获取已检测的视频
        chrome.runtime.sendMessage(
          { type: 'GET_VIDEOS', payload: { pageUrl: tabs[0].url } },
          (response) => {
            if (response?.videos) {
              setVideos(response.videos)
            }
          }
        )
      }
    })
  }, [setVideos])

  // 监听来自 background 的视频更新
  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'VIDEO_DETECTED' && message.payload?.pageUrl === currentTab) {
        setVideos(message.payload.videos)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [currentTab, setVideos])

  const handlePreview = useCallback(
    (video: DetectedVideo) => {
      // 在新标签页中预览
      chrome.tabs.create({
        url: chrome.runtime.getURL(
          `tabs/preview.html?url=${encodeURIComponent(video.url)}&format=${video.format}&title=${encodeURIComponent(video.title)}`
        ),
      })
    },
    []
  )

  const handleDownload = useCallback(
    async (video: DetectedVideo) => {
      chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        payload: { video, downloader: settings.defaultDownloader },
      })
    },
    [settings.defaultDownloader]
  )

  const handleDownloadAll = useCallback(async () => {
    for (const video of filteredVideos) {
      chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        payload: { video, downloader: settings.defaultDownloader },
      })
    }
  }, [filteredVideos, settings.defaultDownloader])

  const handleOpenSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }, [])

  const isDark = settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: settings.accentColor },
      }}
    >
      <div
        style={{
          width: settings.popupWidth,
          minHeight: 200,
          maxHeight: 500,
          display: 'flex',
          flexDirection: 'column',
          background: isDark ? '#141414' : '#fff',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <Title level={5} style={{ margin: 0 }}>
              视频下载器
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {currentTab ? new URL(currentTab).hostname : ''}
              {filteredVideos.length > 0 && ` · ${filteredVideos.length} 个视频`}
            </Text>
          </div>
          <Space>
            <Button
              type="text"
              size="small"
              icon={<AppstoreOutlined />}
              onClick={handleOpenSidePanel}
              title="打开详细面板"
            />
            <Button
              type="text"
              size="small"
              icon={<SettingOutlined />}
              onClick={() =>
                chrome.runtime.openOptionsPage()
              }
              title="设置"
            />
          </Space>
        </div>

        {/* 视频列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <VideoList
            videos={filteredVideos}
            isDetecting={isDetecting}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onDownloadAll={handleDownloadAll}
          />
        </div>
      </div>
    </ConfigProvider>
  )
}

export default IndexPopup
```

- [ ] **Step 4: 验证 Popup 编译**

Run:
```bash
pnpm dev
```

Expected: 点击扩展图标可以看到 Popup 界面。

- [ ] **Step 5: 提交**

```bash
git add src/popup/
git commit -m "feat: add Popup page with video list, preview, and download actions"
```

---

### Task 16: SidePanel 页面

**Files:**
- Create: `src/sidepanel/index.tsx`
- Create: `src/sidepanel/components/FilterPanel.tsx`
- Create: `src/sidepanel/components/PreviewPlayer.tsx`
- Create: `src/sidepanel/components/BatchActions.tsx`

- [ ] **Step 1: 实现 FilterPanel 组件**

```tsx
// src/sidepanel/components/FilterPanel.tsx

import React, { useState } from 'react'
import {
  Collapse,
  Checkbox,
  Select,
  Button,
  Space,
  Typography,
} from 'antd'
import {
  FilterOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import type { VideoFilter, VideoFormat } from '../../types'

const { Text } = Typography

interface FilterPanelProps {
  filter: VideoFilter
  availableSources: string[]
  onFilterChange: (filter: Partial<VideoFilter>) => void
  onReset: () => void
}

const ALL_FORMATS: VideoFormat[] = [
  'mp4', 'mkv', 'webm', 'flv', 'avi',
  'hls', 'dash', 'blob',
]

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filter,
  availableSources,
  onFilterChange,
  onReset,
}) => {
  const [collapsed, setCollapsed] = useState(true)

  const handleFormatsChange = (formats: VideoFormat[]) => {
    onFilterChange({ formats })
  }

  return (
    <Collapse
      ghost
      activeKey={collapsed ? [] : ['filter']}
      onChange={() => setCollapsed(!collapsed)}
      items={[
        {
          key: 'filter',
          label: (
            <Space>
              <FilterOutlined />
              <Text strong>过滤</Text>
              <Text type="secondary">({availableSources.length} 个来源)</Text>
            </Space>
          ),
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 格式过滤 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  视频格式
                </Text>
                <Checkbox.Group
                  options={ALL_FORMATS.map((f) => ({
                    label: f.toUpperCase(),
                    value: f,
                  }))}
                  value={filter.formats}
                  onChange={handleFormatsChange}
                />
              </div>

              {/* 分辨率过滤 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  最低分辨率
                </Text>
                <Select
                  value={filter.minResolution}
                  onChange={(val) => onFilterChange({ minResolution: val })}
                  style={{ width: '100%' }}
                  size="small"
                  options={[
                    { label: '不限', value: 'any' },
                    { label: '≥ 4K', value: '4k' },
                    { label: '≥ 1080p', value: '1080p' },
                    { label: '≥ 720p', value: '720p' },
                    { label: '≥ 480p', value: '480p' },
                    { label: '≥ 360p', value: '360p' },
                  ]}
                />
              </div>

              {/* 大小过滤 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  最小大小
                </Text>
                <Select
                  value={filter.minSize}
                  onChange={(val) => onFilterChange({ minSize: val })}
                  style={{ width: '100%' }}
                  size="small"
                  options={[
                    { label: '不限', value: 'any' },
                    { label: '> 10MB', value: '10mb' },
                    { label: '> 50MB', value: '50mb' },
                    { label: '> 100MB', value: '100mb' },
                    { label: '> 500MB', value: '500mb' },
                  ]}
                />
              </div>

              {/* 时长过滤 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  最小时长
                </Text>
                <Select
                  value={filter.minDuration}
                  onChange={(val) => onFilterChange({ minDuration: val })}
                  style={{ width: '100%' }}
                  size="small"
                  options={[
                    { label: '不限', value: 'any' },
                    { label: '> 1 分钟', value: '1min' },
                    { label: '> 5 分钟', value: '5min' },
                    { label: '> 10 分钟', value: '10min' },
                    { label: '> 30 分钟', value: '30min' },
                  ]}
                />
              </div>

              {/* 视频类型过滤 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  视频类型
                </Text>
                <Select
                  value={filter.videoType}
                  onChange={(val) => onFilterChange({ videoType: val })}
                  style={{ width: '100%' }}
                  size="small"
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '常规视频', value: 'regular' },
                    { label: '流媒体', value: 'streaming' },
                    { label: 'Blob', value: 'blob' },
                  ]}
                />
              </div>

              {/* 排序 */}
              <div>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  排序方式
                </Text>
                <Space>
                  <Select
                    value={filter.sortBy}
                    onChange={(val) => onFilterChange({ sortBy: val })}
                    style={{ width: 120 }}
                    size="small"
                    options={[
                      { label: '检测时间', value: 'detectedAt' },
                      { label: '文件大小', value: 'size' },
                      { label: '分辨率', value: 'resolution' },
                      { label: '时长', value: 'duration' },
                    ]}
                  />
                  <Select
                    value={filter.sortOrder}
                    onChange={(val) => onFilterChange({ sortOrder: val })}
                    style={{ width: 80 }}
                    size="small"
                    options={[
                      { label: '降序', value: 'desc' },
                      { label: '升序', value: 'asc' },
                    ]}
                  />
                </Space>
              </div>

              {/* 重置按钮 */}
              <Button
                size="small"
                icon={<UndoOutlined />}
                onClick={onReset}
              >
                重置过滤
              </Button>
            </div>
          ),
        },
      ]}
    />
  )
}
```

- [ ] **Step 2: 实现 PreviewPlayer 组件**

```tsx
// src/sidepanel/components/PreviewPlayer.tsx

import React, { useEffect, useRef, useState } from 'react'
import { Typography, Space, Tag, Button } from 'antd'
import {
  CloseOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  FullscreenOutlined,
} from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { formatFileSize, formatDuration, getResolutionLabel } from '../../utils/format'
import Hls from 'hls.js'
import dashjs from 'dashjs'

const { Text } = Typography

interface PreviewPlayerProps {
  video: DetectedVideo
  onClose: () => void
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({
  video,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    // 清理之前的实例
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (dashRef.current) {
      dashRef.current.reset()
      dashRef.current = null
    }

    if (video.format === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(video.url)
        hls.attachMedia(videoEl)
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = video.url
      }
    } else if (video.format === 'dash') {
      const player = dashjs.MediaPlayer().create()
      dashRef.current = player
      player.initialize(videoEl, video.url, false)
    } else {
      videoEl.src = video.url
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
      }
      if (dashRef.current) {
        dashRef.current.reset()
      }
    }
  }, [video])

  const togglePlay = () => {
    const videoEl = videoRef.current
    if (!videoEl) return

    if (videoEl.paused) {
      videoEl.play()
      setIsPlaying(true)
    } else {
      videoEl.pause()
      setIsPlaying(false)
    }
  }

  const handleFullscreen = () => {
    videoRef.current?.requestFullscreen()
  }

  return (
    <div style={{ padding: 12 }}>
      {/* 视频播放器 */}
      <div
        style={{
          position: 'relative',
          backgroundColor: '#000',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <video
          ref={videoRef}
          controls
          style={{
            width: '100%',
            maxHeight: 300,
            display: 'block',
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </div>

      {/* 视频信息 */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>
          {video.title || '未命名视频'}
        </Text>
        <Space size={4} wrap>
          <Tag color="purple">{video.format.toUpperCase()}</Tag>
          {video.height && (
            <Tag>{getResolutionLabel(video.width, video.height)}</Tag>
          )}
          {video.size && <Text type="secondary">{formatFileSize(video.size)}</Text>}
          {video.duration && <Text type="secondary">{formatDuration(video.duration)}</Text>}
          <Text type="secondary">来源: {video.domain}</Text>
        </Space>
      </div>

      {/* 操作按钮 */}
      <Space>
        <Button type="primary" onClick={togglePlay} icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}>
          {isPlaying ? '暂停' : '播放'}
        </Button>
        <Button icon={<FullscreenOutlined />} onClick={handleFullscreen}>
          全屏
        </Button>
        <Button icon={<CloseOutlined />} onClick={onClose}>
          关闭预览
        </Button>
      </Space>
    </div>
  )
}
```

- [ ] **Step 3: 实现 BatchActions 组件**

```tsx
// src/sidepanel/components/BatchActions.tsx

import React from 'react'
import { Button, Space, Select, Typography } from 'antd'
import {
  DownloadOutlined,
  ClearOutlined,
} from '@ant-design/icons'
import type { DetectedVideo, DownloaderType } from '../../types'

const { Text } = Typography

interface BatchActionsProps {
  selectedCount: number
  totalCount: number
  onDownloadSelected: () => void
  onDownloadAll: () => void
  onClear: () => void
  downloader: DownloaderType
  onDownloaderChange: (downloader: DownloaderType) => void
}

export const BatchActions: React.FC<BatchActionsProps> = ({
  selectedCount,
  totalCount,
  onDownloadSelected,
  onDownloadAll,
  onClear,
  downloader,
  onDownloaderChange,
}) => {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Space>
        <Select
          value={downloader}
          onChange={onDownloaderChange}
          size="small"
          style={{ width: 100 }}
          options={[
            { label: '浏览器', value: 'chrome' },
            { label: 'IDM', value: 'idm' },
            { label: 'aria2', value: 'aria2' },
            { label: 'Motrix', value: 'motrix' },
          ]}
        />
        <Button
          type="primary"
          size="small"
          icon={<DownloadOutlined />}
          onClick={onDownloadSelected}
          disabled={selectedCount === 0}
        >
          下载选中 ({selectedCount})
        </Button>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={onDownloadAll}
          disabled={totalCount === 0}
        >
          全部下载
        </Button>
      </Space>
      <Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {selectedCount}/{totalCount}
        </Text>
        <Button
          size="small"
          icon={<ClearOutlined />}
          onClick={onClear}
          title="清空列表"
        />
      </Space>
    </div>
  )
}
```

- [ ] **Step 4: 实现 SidePanel 主页面**

```tsx
// src/sidepanel/index.tsx

import React, { useEffect, useState, useCallback } from 'react'
import {
  ConfigProvider,
  theme,
  Typography,
  Checkbox,
  Space,
} from 'antd'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { VideoItem } from './components/VideoItem'
import { FilterPanel } from './components/FilterPanel'
import { PreviewPlayer } from './components/BatchActions'
import { BatchActions } from './components/BatchActions'
import type {
  DetectedVideo,
  ExtensionMessage,
  VideoFilter,
  DownloaderType,
} from '../types'

const { Title, Text } = Typography

function IndexSidePanel() {
  const {
    filteredVideos,
    currentFilter,
    setVideos,
    setFilter,
    clearVideos,
  } = useVideoStore()
  const { settings, loadSettings } = useSettingsStore()

  const [currentTab, setCurrentTab] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null)
  const [downloader, setDownloader] = useState<DownloaderType>('chrome')

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // 获取当前标签页视频
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setCurrentTab(tabs[0].url)
        chrome.runtime.sendMessage(
          { type: 'GET_VIDEOS', payload: { pageUrl: tabs[0].url } },
          (response) => {
            if (response?.videos) {
              setVideos(response.videos)
            }
          }
        )
      }
    })
  }, [setVideos])

  // 监听视频更新
  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'VIDEO_DETECTED' && message.payload?.pageUrl === currentTab) {
        setVideos(message.payload.videos)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [currentTab, setVideos])

  const handleFilterChange = useCallback((filter: Partial<VideoFilter>) => {
    setFilter(filter)
  }, [setFilter])

  const handleResetFilter = useCallback(() => {
    setFilter({
      formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash'],
      minResolution: 'any',
      minSize: 'any',
      minDuration: 'any',
      sources: [],
      videoType: 'all',
      sortBy: 'detectedAt',
      sortOrder: 'desc',
    })
  }, [setFilter])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDownload = useCallback(
    async (video: DetectedVideo) => {
      chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        payload: { video, downloader },
      })
    },
    [downloader]
  )

  const handleDownloadSelected = useCallback(async () => {
    for (const video of filteredVideos) {
      if (selectedIds.has(video.id)) {
        handleDownload(video)
      }
    }
  }, [filteredVideos, selectedIds, handleDownload])

  const handleDownloadAll = useCallback(async () => {
    for (const video of filteredVideos) {
      handleDownload(video)
    }
  }, [filteredVideos, handleDownload])

  const availableSources = [...new Set(filteredVideos.map((v) => v.domain))]

  const isDark =
    settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  // 预览模式
  if (previewVideo) {
    return (
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        }}
      >
        <PreviewPlayer
          video={previewVideo}
          onClose={() => setPreviewVideo(null)}
        />
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: settings.accentColor },
      }}
    >
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: isDark ? '#141414' : '#fff',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            视频下载器
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {currentTab ? new URL(currentTab).hostname : ''} · {filteredVideos.length} 个视频
          </Text>
        </div>

        {/* 过滤面板 */}
        <FilterPanel
          filter={currentFilter}
          availableSources={availableSources}
          onFilterChange={handleFilterChange}
          onReset={handleResetFilter}
        />

        {/* 批量操作 */}
        <BatchActions
          selectedCount={selectedIds.size}
          totalCount={filteredVideos.length}
          onDownloadSelected={handleDownloadSelected}
          onDownloadAll={handleDownloadAll}
          onClear={() => clearVideos()}
          downloader={downloader}
          onDownloaderChange={setDownloader}
        />

        {/* 视频列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredVideos.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <Text type="secondary">未检测到视频</Text>
            </div>
          ) : (
            filteredVideos.map((video) => (
              <div
                key={video.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 12px',
                  borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
                }}
              >
                <Checkbox
                  checked={selectedIds.has(video.id)}
                  onChange={() => toggleSelect(video.id)}
                  style={{ marginRight: 8 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <VideoItem
                    video={video}
                    onPreview={setPreviewVideo}
                    onDownload={handleDownload}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ConfigProvider>
  )
}

export default IndexSidePanel
```

- [ ] **Step 5: 提交**

```bash
git add src/sidepanel/
git commit -m "feat: add SidePanel with filter, preview player, and batch actions"
```

---

### Task 17: Options 设置页

**Files:**
- Create: `src/options/index.tsx`
- Create: `src/options/components/DownloadSettings.tsx`
- Create: `src/options/components/BlacklistManager.tsx`
- Create: `src/options/components/NamingSettings.tsx`
- Create: `src/options/components/AppearanceSettings.tsx`
- Create: `src/options/components/ExternalDownloaderSettings.tsx`

- [ ] **Step 1: 实现 DownloadSettings 组件**

```tsx
// src/options/components/DownloadSettings.tsx

import React from 'react'
import {
  Form,
  InputNumber,
  Switch,
  Select,
  FormItemProps,
} from 'antd'
import { useSettingsStore } from '../../store/settings-store'
import type { DownloaderType } from '../../types'

export const DownloadSettingsPanel: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const ds = settings.downloadSettings

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="默认下载器">
        <Select<DownloaderType>
          value={settings.defaultDownloader}
          onChange={(val) => updateSetting('defaultDownloader', val)}
          options={[
            { label: '浏览器内置', value: 'chrome' },
            { label: 'IDM', value: 'idm' },
            { label: 'aria2', value: 'aria2' },
            { label: 'Motrix', value: 'motrix' },
            { label: '自定义', value: 'custom' },
          ]}
        />
      </Form.Item>

      <Form.Item label="最大并发下载数">
        <InputNumber
          min={1}
          max={5}
          value={ds.maxConcurrent}
          onChange={(val) =>
            updateSetting('downloadSettings', {
              ...ds,
              maxConcurrent: val || 3,
            })
          }
        />
      </Form.Item>

      <Form.Item label="失败重试次数">
        <InputNumber
          min={0}
          max={10}
          value={ds.retryCount}
          onChange={(val) =>
            updateSetting('downloadSettings', {
              ...ds,
              retryCount: val || 3,
            })
          }
        />
      </Form.Item>

      <Form.Item label="重试间隔（毫秒）">
        <InputNumber
          min={500}
          max={30000}
          step={500}
          value={ds.retryDelay}
          onChange={(val) =>
            updateSetting('downloadSettings', {
              ...ds,
              retryDelay: val || 1000,
            })
          }
        />
      </Form.Item>

      <Form.Item label="请求超时（毫秒）">
        <InputNumber
          min={5000}
          max={120000}
          step={5000}
          value={ds.timeout}
          onChange={(val) =>
            updateSetting('downloadSettings', {
              ...ds,
              timeout: val || 30000,
            })
          }
        />
      </Form.Item>

      <Form.Item label="按域名分类保存">
        <Switch
          checked={settings.saveByDomain}
          onChange={(val) => updateSetting('saveByDomain', val)}
        />
      </Form.Item>
    </Form>
  )
}
```

- [ ] **Step 2: 实现 BlacklistManager 组件**

```tsx
// src/options/components/BlacklistManager.tsx

import React, { useState } from 'react'
import {
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Table,
  Popconfirm,
  Typography,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { useSettingsStore } from '../../store/settings-store'
import type { BlacklistRule, BlacklistMatchType } from '../../types'

const { Text } = Typography

export const BlacklistManager: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const [newPattern, setNewPattern] = useState('')
  const [newType, setNewType] = useState<BlacklistMatchType>('domain')

  const addRule = () => {
    if (!newPattern.trim()) return
    const rule: BlacklistRule = {
      id: `bl_${Date.now()}`,
      pattern: newPattern.trim(),
      type: newType,
      reason: '',
      enabled: true,
    }
    updateSetting('blacklist', [...settings.blacklist, rule])
    setNewPattern('')
  }

  const removeRule = (id: string) => {
    updateSetting(
      'blacklist',
      settings.blacklist.filter((r) => r.id !== id)
    )
  }

  const toggleRule = (id: string) => {
    updateSetting(
      'blacklist',
      settings.blacklist.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      )
    )
  }

  const columns = [
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 60,
      render: (enabled: boolean, record: BlacklistRule) => (
        <Switch
          size="small"
          checked={enabled}
          onChange={() => toggleRule(record.id)}
        />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (type: string) => (
        <Text type="secondary">{type}</Text>
      ),
    },
    {
      title: '匹配规则',
      dataIndex: 'pattern',
      ellipsis: true,
    },
    {
      title: '备注',
      dataIndex: 'reason',
      width: 120,
      render: (reason?: string) => (
        <Text type="secondary">{reason || '-'}</Text>
      ),
    },
    {
      title: '操作',
      width: 60,
      render: (_: any, record: BlacklistRule) => (
        <Popconfirm
          title="确定删除？"
          onConfirm={() => removeRule(record.id)}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="输入匹配规则"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onPressEnter={addRule}
          style={{ width: 200 }}
        />
        <Select
          value={newType}
          onChange={setNewType}
          style={{ width: 100 }}
          size="small"
          options={[
            { label: '域名', value: 'domain' },
            { label: 'URL', value: 'url' },
            { label: '正则', value: 'regex' },
          ]}
        />
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addRule}>
          添加
        </Button>
      </Space>

      <Table
        dataSource={settings.blacklist}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
      />
    </div>
  )
}
```

- [ ] **Step 3: 实现 NamingSettings 组件**

```tsx
// src/options/components/NamingSettings.tsx

import React from 'react'
import { Form, Input, Typography, Space } from 'antd'
import { useSettingsStore } from '../../store/settings-store'

const { Text } = Typography

export const NamingSettings: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="文件命名模板">
        <Input
          value={settings.namingTemplate}
          onChange={(e) => updateSetting('namingTemplate', e.target.value)}
          placeholder="{name}.{format}"
        />
        <Space style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            可用变量:
          </Text>
          {['{name}', '{domain}', '{date}', '{resolution}', '{format}'].map(
            (v) => (
              <Text
                key={v}
                code
                style={{ fontSize: 12, cursor: 'pointer' }}
                onClick={() =>
                  updateSetting(
                    'namingTemplate',
                    settings.namingTemplate + v
                  )
                }
              >
                {v}
              </Text>
            )
          )}
        </Space>
      </Form.Item>

      <Form.Item label="预览">
        <Text code style={{ fontSize: 12 }}>
          示例: 斗罗大陆_第120集.mp4
        </Text>
      </Form.Item>
    </Form>
  )
}
```

- [ ] **Step 4: 实现 AppearanceSettings 组件**

```tsx
// src/options/components/AppearanceSettings.tsx

import React from 'react'
import { Form, Select, Switch, Radio, ColorPicker, InputNumber } from 'antd'
import { useSettingsStore } from '../../store/settings-store'
import type { ThemeMode, ListDensity, VisibleColumn } from '../../types'

export const AppearanceSettings: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="主题模式">
        <Select<ThemeMode>
          value={settings.themeMode}
          onChange={(val) => updateSetting('themeMode', val)}
          options={[
            { label: '亮色', value: 'light' },
            { label: '暗色', value: 'dark' },
            { label: '跟随系统', value: 'system' },
          ]}
        />
      </Form.Item>

      <Form.Item label="主题色">
        <ColorPicker
          value={settings.accentColor}
          onChange={(_, hex) => updateSetting('accentColor', hex)}
        />
      </Form.Item>

      <Form.Item label="语言">
        <Select
          value={settings.language}
          onChange={(val) => updateSetting('language', val)}
          options={[
            { label: '中文', value: 'zh' },
            { label: 'English', value: 'en' },
          ]}
        />
      </Form.Item>

      <Form.Item label="Popup 宽度">
        <Radio.Group
          value={settings.popupWidth}
          onChange={(e) => updateSetting('popupWidth', e.target.value)}
          options={[
            { label: '窄 (320px)', value: 320 },
            { label: '标准 (400px)', value: 400 },
            { label: '宽 (500px)', value: 500 },
          ]}
        />
      </Form.Item>

      <Form.Item label="列表密度">
        <Select<ListDensity>
          value={settings.listDensity}
          onChange={(val) => updateSetting('listDensity', val)}
          options={[
            { label: '紧凑', value: 'compact' },
            { label: '标准', value: 'standard' },
            { label: '详细', value: 'detailed' },
          ]}
        />
      </Form.Item>

      <Form.Item label="下载完成通知">
        <Space>
          <Switch
            checked={settings.notifications}
            onChange={(val) => updateSetting('notifications', val)}
          />
          <Switch
            checked={settings.notificationSound}
            onChange={(val) => updateSetting('notificationSound', val)}
            disabled={!settings.notifications}
          />
        </Space>
      </Form.Item>

      <Form.Item label="自动清理天数（0 为不清理）">
        <InputNumber
          min={0}
          max={365}
          value={settings.autoCleanupDays}
          onChange={(val) => updateSetting('autoCleanupDays', val || 0)}
        />
      </Form.Item>
    </Form>
  )
}
```

- [ ] **Step 5: 实现 ExternalDownloaderSettings 组件**

```tsx
// src/options/components/ExternalDownloaderSettings.tsx

import React from 'react'
import { Form, Input } from 'antd'
import { useSettingsStore } from '../../store/settings-store'

export const ExternalDownloaderSettings: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const config = settings.externalDownloaderConfig

  const updateConfig = (key: string, value: string) => {
    updateSetting('externalDownloaderConfig', {
      ...config,
      [key]: value,
    })
  }

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="aria2 RPC 地址">
        <Input
          value={config.aria2RpcUrl}
          onChange={(e) => updateConfig('aria2RpcUrl', e.target.value)}
          placeholder="http://localhost:6800/jsonrpc"
        />
      </Form.Item>

      <Form.Item label="aria2 RPC 密钥">
        <Input.Password
          value={config.aria2RpcSecret}
          onChange={(e) => updateConfig('aria2RpcSecret', e.target.value)}
          placeholder="留空表示无密钥"
        />
      </Form.Item>

      <Form.Item label="IDM 路径（可选）">
        <Input
          value={config.idmPath}
          onChange={(e) => updateConfig('idmPath', e.target.value)}
          placeholder="C:\Program Files\Internet Download Manager\IDMan.exe"
        />
      </Form.Item>

      <Form.Item label="自定义命令（可选）">
        <Input
          value={config.customCommand}
          onChange={(e) => updateConfig('customCommand', e.target.value)}
          placeholder="如: curl"
        />
      </Form.Item>

      <Form.Item label="自定义命令参数">
        <Input
          value={config.customCommandArgs}
          onChange={(e) => updateConfig('customCommandArgs', e.target.value)}
          placeholder="如: -o {filename} {url}"
        />
      </Form.Item>
    </Form>
  )
}
```

- [ ] **Step 6: 实现 Options 主页面**

```tsx
// src/options/index.tsx

import React, { useEffect } from 'react'
import {
  ConfigProvider,
  theme,
  Typography,
  Tabs,
  Button,
  Space,
} from 'antd'
import { UndoOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../store/settings-store'
import { DownloadSettingsPanel } from './components/DownloadSettings'
import { BlacklistManager } from './components/BlacklistManager'
import { NamingSettings } from './components/NamingSettings'
import { AppearanceSettings } from './components/AppearanceSettings'
import { ExternalDownloaderSettings } from './components/ExternalDownloaderSettings'

const { Title } = Typography

function IndexOptions() {
  const { settings, loadSettings, resetSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const isDark =
    settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const tabItems = [
    {
      key: 'download',
      label: '下载设置',
      children: <DownloadSettingsPanel />,
    },
    {
      key: 'naming',
      label: '命名规则',
      children: <NamingSettings />,
    },
    {
      key: 'blacklist',
      label: '黑名单管理',
      children: <BlacklistManager />,
    },
    {
      key: 'downloader',
      label: '外部下载器',
      children: <ExternalDownloaderSettings />,
    },
    {
      key: 'appearance',
      label: '界面设置',
      children: <AppearanceSettings />,
    },
  ]

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: settings.accentColor },
      }}
    >
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: 24,
          background: isDark ? '#141414' : '#fff',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            视频下载器 - 设置
          </Title>
          <Button
            icon={<UndoOutlined />}
            onClick={resetSettings}
            size="small"
          >
            恢复默认
          </Button>
        </div>

        <Tabs items={tabItems} />
      </div>
    </ConfigProvider>
  )
}

export default IndexOptions
```

- [ ] **Step 7: 提交**

```bash
git add src/options/
git commit -m "feat: add Options settings page with download, naming, blacklist, appearance, and downloader config"
```

---

### Task 18: 新标签页预览页

**Files:**
- Create: `src/tabs/preview/index.tsx`
- Create: `src/tabs/preview/components/FullPlayer.tsx`

- [ ] **Step 1: 实现全屏播放器组件**

```tsx
// src/tabs/preview/components/FullPlayer.tsx

import React, { useEffect, useRef, useState } from 'react'
import { Typography, Space, Tag, Button } from 'antd'
import {
  DownloadOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons'
import type { DetectedVideo } from '../../../types'
import { formatFileSize, formatDuration, getResolutionLabel } from '../../../utils/format'
import Hls from 'hls.js'
import dashjs from 'dashjs'

const { Title, Text } = Typography

interface FullPlayerProps {
  video: DetectedVideo
  onDownload: () => void
  onBack: () => void
}

export const FullPlayer: React.FC<FullPlayerProps> = ({
  video,
  onDownload,
  onBack,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<any>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (dashRef.current) {
      dashRef.current.reset()
      dashRef.current = null
    }

    if (video.format === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(video.url)
        hls.attachMedia(videoEl)
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = video.url
      }
    } else if (video.format === 'dash') {
      const player = dashjs.MediaPlayer().create()
      dashRef.current = player
      player.initialize(videoEl, video.url, false)
    } else {
      videoEl.src = video.url
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy()
      if (dashRef.current) dashRef.current.reset()
    }
  }, [video])

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 24,
        background: '#000',
        minHeight: '100vh',
        color: '#fff',
      }}
    >
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="text"
          icon={<ArrowBackIcon />}
          onClick={onBack}
          style={{ color: '#fff' }}
        >
          返回
        </Button>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={onDownload}
        >
          下载
        </Button>
      </Space>

      <video
        ref={videoRef}
        controls
        autoPlay
        style={{
          width: '100%',
          maxHeight: '70vh',
          display: 'block',
          margin: '0 auto',
          borderRadius: 8,
        }}
      />

      <div style={{ marginTop: 16 }}>
        <Title level={4} style={{ color: '#fff', margin: '0 0 8px' }}>
          {video.title || '未命名视频'}
        </Title>
        <Space wrap>
          <Tag>{video.format.toUpperCase()}</Tag>
          {video.height && <Tag>{getResolutionLabel(video.width, video.height)}</Tag>}
          {video.size && <Text style={{ color: '#999' }}>{formatFileSize(video.size)}</Text>}
          {video.duration && <Text style={{ color: '#999' }}>{formatDuration(video.duration)}</Text>}
          <Text style={{ color: '#999' }}>来源: {video.domain}</Text>
        </Space>
      </div>
    </div>
  )
}

// 简单返回图标（避免 antd v5 兼容问题）
function ArrowBackIcon() {
  return <ArrowLeftOutlined />
}
```

- [ ] **Step 2: 实现预览页主入口**

```tsx
// src/tabs/preview/index.tsx

import React, { useEffect, useState } from 'react'
import { ConfigProvider, theme, Spin } from 'antd'
import { FullPlayer } from './components/FullPlayer'
import type { DetectedVideo } from '../../types'

function PreviewPage() {
  const [video, setVideo] = useState<DetectedVideo | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const url = params.get('url')
    const format = params.get('format') || 'mp4'
    const title = params.get('title') || ''

    if (url) {
      setVideo({
        id: `preview_${Date.now()}`,
        url,
        title: decodeURIComponent(title),
        format: format as DetectedVideo['format'],
        mimeType: '',
        source: 'network',
        pageUrl: '',
        domain: '',
        detectedAt: Date.now(),
      })
    }
  }, [])

  if (!video) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  const handleDownload = () => {
    chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      payload: { video, downloader: 'chrome' },
    })
  }

  const handleBack = () => {
    window.history.back()
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <FullPlayer
        video={video}
        onDownload={handleDownload}
        onBack={handleBack}
      />
    </ConfigProvider>
  )
}

export default PreviewPage
```

- [ ] **Step 3: 提交**

```bash
git add src/tabs/
git commit -m "feat: add new tab preview page with full player"
```

---

## 阶段 5：集成测试与优化

### Task 19: 端到端手动测试

- [ ] **Step 1: 在测试网站上验证视频检测**

Run:
```bash
pnpm dev
```

打开测试网站并验证：
1. https://www.hanpian.top/yun/21923/1/4/ — 验证 HLS 视频检测
2. https://www.85po.com/v/3596/japanese-jk/ — 验证常规视频检测
3. https://xhamster.com/videos/insta-live-11149445 — 验证其他视频检测

验证项：
- [ ] Popup 中能显示检测到的视频列表
- [ ] 视频标题能正确识别（非乱码）
- [ ] 格式标签正确（HLS/mp4 等）
- [ ] 黑名单过滤广告视频
- [ ] 点击预览能正常播放

- [ ] **Step 2: 验证下载功能**

- [ ] 单个视频下载正常
- [ ] 全部下载正常
- [ ] 下载进度显示
- [ ] 文件保存到正确目录
- [ ] 文件命名正确

- [ ] **Step 3: 验证设置功能**

- [ ] Options 页面能正常打开
- [ ] 切换主题（亮/暗）立即生效
- [ ] 黑名单添加/删除/启用/禁用正常
- [ ] 命名模板修改后下载文件名符合预期
- [ ] 设置持久化（关闭浏览器后重新打开设置仍在）

- [ ] **Step 4: 验证 SidePanel**

- [ ] 过滤功能正常
- [ ] 排序功能正常
- [ ] 内嵌预览播放正常
- [ ] 批量选择和下载正常

- [ ] **Step 5: 修复发现的问题并提交**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```

---

### Task 20: 生产构建与图标

- [ ] **Step 1: 准备扩展图标**

创建或替换以下图标文件（需要 16x16、48x48、128x128 三种尺寸的 PNG）：
- `src/assets/icon16.png`
- `src/assets/icon48.png`
- `src/assets/icon128.png`

- [ ] **Step 2: 生产构建**

```bash
pnpm build
```

Expected: `build/` 目录生成完整的扩展包，可直接加载到 Chrome。

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "chore: production build and final polish"
```
