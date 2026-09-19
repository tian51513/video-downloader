import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DetectedVideo } from '../types'
import { createChromeMock } from './chrome-mock'

/**
 * 测试：失败与取消的任务语义（真实模块行为）
 *
 * 核心行为：
 * 1. failDownloadTask：任务置 failed 并保留具体错误信息（来自页面/save-helper 的诊断）
 * 2. cancelDownload：任务置 failed 且错误为"已取消"（用户主动取消）
 * 3. PAGE_FETCH_ERROR / SAVE_HELPER_DONE 失败路径应使用 failDownloadTask 而非 cancelDownload
 */

vi.stubGlobal('chrome', createChromeMock().chrome)

// mock storage（getAllDownloadTasks 会从 storage 重载，get 需镜像 save 的内容）
const storageState = vi.hoisted(() => ({ tasks: [] as any[] }))
vi.mock('../utils/storage', () => ({
  saveDownloads: vi.fn((tasks: any[]) => {
    storageState.tasks = JSON.parse(JSON.stringify(tasks))
    return Promise.resolve()
  }),
  getDownloads: vi.fn(() => Promise.resolve(storageState.tasks)),
}))

vi.mock('../background/settings', () => ({
  getFullSettings: vi.fn(() =>
    Promise.resolve({ downloadSettings: { maxConcurrent: 3, askSaveLocation: false } })
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

const { createDownloadTask, failDownloadTask, cancelDownload, getAllDownloadTasks } = await import(
  '../background/download-manager'
)

const makeVideo = (): DetectedVideo => ({
  id: 'v_' + Math.random().toString(36).slice(2, 8),
  url: `https://example.com/video-${Math.random().toString(36).slice(2, 6)}.mp4`,
  title: 'Test Video',
  format: 'mp4',
  mimeType: 'video/mp4',
  source: 'network',
  pageUrl: 'https://example.com/',
  domain: 'example.com',
  detectedAt: Date.now(),
})

describe('失败与取消的任务语义', () => {
  beforeEach(() => {
    storageState.tasks = []
    vi.clearAllMocks()
  })

  it('failDownloadTask 置 failed 并保留诊断错误信息', async () => {
    const task = await createDownloadTask(makeVideo(), 'chrome')

    await failDownloadTask(task.id, 'TypeError: Failed to fetch')

    const stored = (await getAllDownloadTasks()).find((t) => t.id === task.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.error).toBe('TypeError: Failed to fetch')
  })

  it('failDownloadTask 无错误信息时使用默认文案', async () => {
    const task = await createDownloadTask(makeVideo(), 'chrome')

    await failDownloadTask(task.id)

    const stored = (await getAllDownloadTasks()).find((t) => t.id === task.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.error).toBe('下载失败')
  })

  it('cancelDownload 置 failed 且错误为"已取消"', async () => {
    const task = await createDownloadTask(makeVideo(), 'chrome')

    await cancelDownload(task.id)

    const stored = (await getAllDownloadTasks()).find((t) => t.id === task.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.error).toBe('已取消')
  })
})
