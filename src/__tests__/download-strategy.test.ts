import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DetectedVideo } from '../types'
import { createChromeMock } from './chrome-mock'

/**
 * 测试：下载策略分发（真实模块行为）
 *
 * 核心行为：
 * 1. 非 HLS 视频 → chrome.downloads.download（Layer 1 直下）
 * 2. HLS 视频 → 委托给 hls-downloader，不走 chrome.downloads
 */

const { chrome, downloadCalls, onChangedListeners } = createChromeMock()
vi.stubGlobal('chrome', chrome)

vi.mock('../utils/storage', () => ({
  saveDownloads: vi.fn(() => Promise.resolve()),
  getDownloads: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../background/settings', () => ({
  getFullSettings: vi.fn(() =>
    Promise.resolve({
      downloadSettings: { maxConcurrent: 3, askSaveLocation: false },
      externalDownloaderConfig: { aria2RpcUrl: 'http://localhost:6800/jsonrpc' },
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

  it('aria2 下载器 → JSON-RPC aria2.addUri，不经由 chrome.downloads', async () => {
    const fetchMock = vi.fn((_url: string | URL | RequestInfo, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ result: 'gid_123' }) })
    )
    vi.stubGlobal('fetch', fetchMock)

    const video = makeVideo({ url: 'https://example.com/external.mp4' })
    await createDownloadTask(video, 'aria2')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [rpcUrl, init] = fetchMock.mock.calls[0]
    expect(rpcUrl).toBe('http://localhost:6800/jsonrpc')
    const body = JSON.parse(String(init?.body))
    expect(body.method).toBe('aria2.addUri')
    expect(body.params[0]).toEqual(['https://example.com/external.mp4'])
    expect(downloadCalls.length).toBe(0)
  })
})
