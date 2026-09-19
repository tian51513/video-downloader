import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DetectedVideo } from '../types'
import { createChromeMock } from './chrome-mock'

/**
 * 测试：下载去重
 *
 * 核心行为：
 * 1. 同一 URL 的视频不应创建多个下载任务
 * 2. 已有 downloading/completed 任务的 URL 不应再创建新任务
 * 3. 已有 pending 任务的 URL 应返回已有任务
 */

// 导入被测模块的纯逻辑
// createDownloadTask 有副作用（chrome API、processQueue），
// 所以我们测试的是 downloadQueue 的去重行为

// mock chrome API
let mockPersistCalls: any[] = []

vi.stubGlobal('chrome', createChromeMock().chrome)

// mock storage（getAllDownloadTasks 会从 storage 重载，get 需镜像 save 的内容）
const storageState = vi.hoisted(() => ({ tasks: [] as any[] }))
vi.mock('../utils/storage', () => ({
  saveDownloads: vi.fn((tasks) => {
    mockPersistCalls.push(JSON.parse(JSON.stringify(tasks)))
    storageState.tasks = JSON.parse(JSON.stringify(tasks))
    return Promise.resolve()
  }),
  getDownloads: vi.fn(() => Promise.resolve(storageState.tasks)),
}))

// mock settings
vi.mock('../background/settings', () => ({
  getFullSettings: vi.fn(() =>
    Promise.resolve({
      downloadSettings: { maxConcurrent: 3, askSaveLocation: false },
    })
  ),
  initDefaultSettings: vi.fn(() => Promise.resolve()),
}))

// mock offscreen-blob
vi.mock('../utils/offscreen-blob', () => ({
  fetchAndDownload: vi.fn(),
  ensureOffscreen: vi.fn(),
}))

// mock hls-downloader
vi.mock('../background/hls-downloader', () => ({
  downloadHls: vi.fn(),
}))

// mock sanitize
vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

// 使用动态 import 来应用 mocks
const { createDownloadTask, getAllDownloadTasks, cancelDownload, completeDownloadTask, failDownloadTask } = await import(
  '../background/download-manager'
)

function makeVideo(overrides: Partial<DetectedVideo> = {}): DetectedVideo {
  return {
    id: 'v_' + Math.random().toString(36).slice(2, 8),
    url: 'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
    title: 'Ｍｒ．りお',
    format: 'mp4',
    mimeType: 'video/mp4',
    source: 'network',
    pageUrl: 'https://www.85po.com/v/21417/ri-o/',
    domain: 'www.85po.com',
    detectedAt: Date.now(),
    ...overrides,
  }
}

describe('下载去重：同一 URL 不应创建多个任务', () => {
  beforeEach(() => {
    mockPersistCalls = []
    storageState.tasks = []
    vi.clearAllMocks()
  })

  it('同一 URL、不同 video ID 的两个视频，第二次调用应返回已有任务', async () => {
    const video1 = makeVideo({ id: 'video_abc_0' })
    const video2 = makeVideo({ id: 'video_abc_1' }) // 同 URL，不同 ID

    const task1 = await createDownloadTask(video1, 'chrome')
    const task2 = await createDownloadTask(video2, 'chrome')

    // 核心断言：应返回同一个任务
    expect(task2.id).toBe(task1.id)
  })

  it('不同 URL 的视频应创建不同任务', async () => {
    const video1 = makeVideo({
      id: 'video_a',
      url: 'https://example.com/video1.mp4',
    })
    const video2 = makeVideo({
      id: 'video_b',
      url: 'https://example.com/video2.mp4',
    })

    const task1 = await createDownloadTask(video1, 'chrome')
    const task2 = await createDownloadTask(video2, 'chrome')

    expect(task1.id).not.toBe(task2.id)
  })

  it('已完成的任务不应被重复创建', async () => {
    const video = makeVideo({ id: 'video_x' })

    const task1 = await createDownloadTask(video, 'chrome')
    await completeDownloadTask(task1.id)

    const task2 = await createDownloadTask(video, 'chrome')

    expect(task2.id).toBe(task1.id)
  })

  it('已失败的任务允许重新创建（重试路径）', async () => {
    const video = makeVideo({ id: 'video_y' })

    const task1 = await createDownloadTask(video, 'chrome')
    await failDownloadTask(task1.id, 'boom')

    const task2 = await createDownloadTask(video, 'chrome')

    // 失败任务不参与去重：应创建新任务，且旧任务保留在队列中
    expect(task2.id).not.toBe(task1.id)
    const all = await getAllDownloadTasks()
    const ids = all.map((t) => t.id)
    expect(ids).toContain(task1.id)
    expect(ids).toContain(task2.id)
  })
})
