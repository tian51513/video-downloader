import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DetectedVideo } from '../types'

/**
 * 测试：下载策略分发（真实模块行为）
 *
 * 核心行为：
 * 1. 非 HLS 视频 → chrome.downloads.download（Layer 1 直下）
 * 2. HLS 视频 → 委托给 hls-downloader，不走 chrome.downloads
 */

const onChangedListeners: Function[] = []
const downloadCalls: any[] = []

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn((msg: any) => {
      if (msg.type === 'SAVE_HELPER_FETCH_DOWNLOAD') {
        return Promise.reject(new Error('no receiver'))
      }
      return Promise.resolve({})
    }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    getURL: vi.fn((p: string) => p),
    lastError: undefined,
  },
  downloads: {
    download: vi.fn((options: any) => {
      downloadCalls.push(options)
      return Promise.resolve(101)
    }),
    search: vi.fn(() => Promise.resolve([{ totalBytes: 100, bytesReceived: 100 }])),
    onChanged: {
      addListener: vi.fn((l: Function) => onChangedListeners.push(l)),
      removeListener: vi.fn(),
    },
    onDeterminingFilename: { addListener: vi.fn() },
  },
  offscreen: {
    hasDocument: vi.fn(() => Promise.resolve(true)),
    createDocument: vi.fn(() => Promise.resolve()),
  },
  declarativeNetRequest: {
    updateSessionRules: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([{ id: 1 }])),
    // Layer 3：无接收方 → undefined → 快速失败
    sendMessage: vi.fn(() => Promise.resolve(undefined)),
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{ result: 'test title' }])),
  },
})

vi.mock('../utils/storage', () => ({
  saveDownloads: vi.fn(() => Promise.resolve()),
  getDownloads: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../background/settings', () => ({
  getFullSettings: vi.fn(() =>
    Promise.resolve({
      downloadSettings: { maxConcurrent: 3, askSaveLocation: false },
    })
  ),
  initDefaultSettings: vi.fn(() => Promise.resolve()),
}))

vi.mock('../utils/offscreen-blob', () => ({
  fetchAndDownload: vi.fn(() => Promise.reject(new Error('offscreen unavailable'))),
  ensureOffscreen: vi.fn(),
}))

vi.mock('../background/hls-downloader', () => ({
  downloadHls: vi.fn(() => Promise.resolve({ savedFileName: 'x.mp4' })),
}))

vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

const { createDownloadTask } = await import('../background/download-manager')
const { downloadHls } = await import('../background/hls-downloader')

const makeVideo = (overrides: Partial<DetectedVideo> = {}): DetectedVideo => ({
  id: 'v_' + Math.random().toString(36).slice(2, 8),
  url: 'https://example.com/video.mp4',
  title: 'Test Video',
  format: 'mp4',
  mimeType: 'video/mp4',
  source: 'network',
  pageUrl: 'https://example.com/',
  domain: 'example.com',
  detectedAt: Date.now(),
  ...overrides,
})

const flush = () => new Promise((r) => setTimeout(r, 100))

// 触发 chrome.downloads.onChanged complete，让 monitorChromeDownload 收敛
const completeChromeDownload = () => {
  onChangedListeners.forEach((l) => l({ id: 101, state: { current: 'complete' } }))
}

describe('下载策略分发', () => {
  beforeEach(() => {
    downloadCalls.length = 0
    onChangedListeners.length = 0
    vi.clearAllMocks()
  })

  it('非 HLS 视频 → Layer 1 chrome.downloads.download，携带 URL 与带扩展名的文件名', async () => {
    const video = makeVideo({ format: 'mp4' })

    await createDownloadTask(video, 'chrome')
    await flush()

    expect(downloadCalls.length).toBe(1)
    expect(downloadCalls[0].url).toBe('https://example.com/video.mp4')
    expect(downloadCalls[0].filename).toMatch(/\.mp4$/)
    expect(downloadHls).not.toHaveBeenCalled()

    completeChromeDownload()
    await flush()
  })

  it('HLS 视频 → 委托 hls-downloader，不经由 chrome.downloads', async () => {
    const video = makeVideo({
      format: 'hls',
      url: 'https://example.com/master.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
    })

    await createDownloadTask(video, 'chrome')
    await flush()

    expect(downloadHls).toHaveBeenCalledTimes(1)
    expect(downloadCalls.length).toBe(0)
  })
})
