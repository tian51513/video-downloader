import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 测试：下载进度应单调递增
 *
 * 核心行为：
 * 1. updateTaskProgressFromPage 不应将进度设为比当前值更低的值
 * 2. 新层的进度报告不应导致进度倒退
 */

let mockBroadcastCalls: any[] = []

// Minimal chrome mock
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn((msg) => {
      mockBroadcastCalls.push(msg)
      return Promise.resolve({})
    }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
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
  fetchAndDownload: vi.fn(),
  ensureOffscreen: vi.fn(),
}))

vi.mock('../background/hls-downloader', () => ({
  downloadHls: vi.fn(),
}))

vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

const { createDownloadTask, updateTaskProgressFromPage } = await import(
  '../background/download-manager'
)

describe('下载进度单调性', () => {
  beforeEach(() => {
    mockBroadcastCalls = []
    vi.clearAllMocks()
  })

  it('进度报告不应导致进度倒退', async () => {
    const video = {
      id: 'test_video',
      url: 'https://example.com/video.mp4',
      title: 'Test Video',
      format: 'mp4',
      mimeType: 'video/mp4',
      source: 'network',
      pageUrl: 'https://example.com/',
      domain: 'example.com',
      detectedAt: Date.now(),
    }

    const task = await createDownloadTask(video, 'chrome')

    // 模拟进度推进到 75%
    updateTaskProgressFromPage(task.id, 75, 1000, 7500000, 10000000)

    // 模拟新层的进度报告（可能从 0% 开始）
    updateTaskProgressFromPage(task.id, 10, 500, 1000000, 10000000)

    // 查找最新的 DOWNLOAD_PROGRESS 广播
    const progressUpdates = mockBroadcastCalls.filter(
      (m) => m.type === 'DOWNLOAD_PROGRESS'
    )
    const lastUpdate = progressUpdates[progressUpdates.length - 1]?.payload

    // 核心断言：进度不应低于之前的 75%
    expect(lastUpdate.progress).toBeGreaterThanOrEqual(75)
  })

  it('更高进度应正常更新', async () => {
    const video = {
      id: 'test_video_2',
      url: 'https://example.com/video2.mp4',
      title: 'Test Video 2',
      format: 'mp4',
      mimeType: 'video/mp4',
      source: 'network',
      pageUrl: 'https://example.com/',
      domain: 'example.com',
      detectedAt: Date.now(),
    }

    const task = await createDownloadTask(video, 'chrome')

    updateTaskProgressFromPage(task.id, 30, 500, 3000000, 10000000)
    updateTaskProgressFromPage(task.id, 60, 800, 6000000, 10000000)

    const progressUpdates = mockBroadcastCalls.filter(
      (m) => m.type === 'DOWNLOAD_PROGRESS'
    )
    const lastUpdate = progressUpdates[progressUpdates.length - 1]?.payload

    expect(lastUpdate.progress).toBe(60)
  })

  it('相同进度值应正常通过', async () => {
    const video = {
      id: 'test_video_3',
      url: 'https://example.com/video3.mp4',
      title: 'Test Video 3',
      format: 'mp4',
      mimeType: 'video/mp4',
      source: 'network',
      pageUrl: 'https://example.com/',
      domain: 'example.com',
      detectedAt: Date.now(),
    }

    const task = await createDownloadTask(video, 'chrome')

    updateTaskProgressFromPage(task.id, 50, 500, 5000000, 10000000)
    updateTaskProgressFromPage(task.id, 50, 600, 5000000, 10000000)

    const progressUpdates = mockBroadcastCalls.filter(
      (m) => m.type === 'DOWNLOAD_PROGRESS'
    )
    const lastUpdate = progressUpdates[progressUpdates.length - 1]?.payload

    expect(lastUpdate.progress).toBe(50)
    expect(lastUpdate.speed).toBe(600) // speed 应更新
  })
})
