import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 测试：下载层降级不应重复尝试相同机制
 *
 * 新流程顺序：direct → offscreen → save-helper
 * 核心行为：
 * 1. downloadDirectly (Layer 1) 失败后，降级到 offscreen (Layer 2)
 * 2. offscreen fetch 失败后，downloadViaSaveHelper 不应再尝试 offscreen
 * 3. 总共只应有一次 offscreen fetch 调用
 */

let offscreenCallCount = 0
let lastOffscreenOptions: any = null
let saveHelperTabCreated = false
let directDownloadCalled = false

// Mock chrome API
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn((message) => {
      if (message.type === 'OFFSCREEN_FETCH_AND_DOWNLOAD') {
        offscreenCallCount++
        lastOffscreenOptions = message.payload
        return Promise.reject(new Error('offscreen fetch failed'))
      }
      // Layer 4 (save-helper)：无接收方 → 快速失败，让降级链收敛
      if (message.type === 'SAVE_HELPER_FETCH_DOWNLOAD') {
        return Promise.reject(new Error('no receiver'))
      }
      return Promise.resolve({})
    }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: vi.fn((path) => `chrome-extension://fake-id/${path}`),
    lastError: undefined,
  },
  tabs: {
    create: vi.fn(() => {
      saveHelperTabCreated = true
      return Promise.resolve({ id: 999 })
    }),
    query: vi.fn(() => Promise.resolve([{ id: 1 }])),
    get: vi.fn(() => Promise.resolve({ id: 1, url: 'https://www.85po.com/v/21417/ri-o/' })),
    // Layer 3 (页面 fetch)：无接收方 → sendMessage 返回 undefined → 快速失败
    sendMessage: vi.fn(() => Promise.resolve(undefined)),
  },
  downloads: {
    // Layer 1 (downloadDirectly) must fail so the test can verify Layer 2 (offscreen) is reached
    download: vi.fn((options, callback) => {
      directDownloadCalled = true
      // Simulate failure: set lastError so downloadDirectly rejects
      chrome.runtime.lastError = { message: 'NETWORK_FAILED' }
      if (callback) callback(undefined as any)
      // Reset lastError after callback
      chrome.runtime.lastError = undefined
    }),
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onDeterminingFilename: {
      addListener: vi.fn(),
    },
    search: vi.fn((_, cb) => cb?.([{ totalBytes: 100, bytesReceived: 100 }])),
  },
  offscreen: {
    hasDocument: vi.fn(() => Promise.resolve(true)),
    createDocument: vi.fn(() => Promise.resolve()),
  },
  declarativeNetRequest: {
    updateSessionRules: vi.fn(() => Promise.resolve()),
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{ result: 'test title' }])),
  },
})

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
    Promise.resolve({
      downloadSettings: { maxConcurrent: 3, askSaveLocation: false },
    })
  ),
  initDefaultSettings: vi.fn(() => Promise.resolve()),
}))

vi.mock('../utils/offscreen-blob', () => ({
  fetchAndDownload: vi.fn((options) => {
    offscreenCallCount++
    lastOffscreenOptions = options
    return Promise.reject(new Error('offscreen fetch failed'))
  }),
  ensureOffscreen: vi.fn(),
}))

vi.mock('../background/hls-downloader', () => ({
  downloadHls: vi.fn(),
}))

vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

const { createDownloadTask, getAllDownloadTasks } = await import('../background/download-manager')

describe('下载层降级：不重复尝试相同机制', () => {
  beforeEach(() => {
    offscreenCallCount = 0
    lastOffscreenOptions = null
    saveHelperTabCreated = false
    directDownloadCalled = false
    vi.clearAllMocks()
  })

  it('offscreen fetch 失败后，总共只应调用一次 offscreen（不应重复尝试）', async () => {
    const video: import('../types').DetectedVideo = {
      id: 'test_video',
      url: 'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      title: 'Ｍｒ．りお',
      format: 'mp4',
      mimeType: 'video/mp4',
      source: 'network',
      pageUrl: 'https://www.85po.com/v/21417/ri-o/',
      domain: 'www.85po.com',
      detectedAt: Date.now(),
    }

    const task = await createDownloadTask(video, 'chrome')

    // 等待异步下载层完成
    await new Promise((r) => setTimeout(r, 500))

    // 核心断言：offscreen fetch 只应被调用一次
    // Layer 1 (downloadDirectly) 失败，降级到 Layer 2 (offscreen)
    // Layer 3/4 不应再调用 offscreen
    expect(offscreenCallCount).toBe(1)

    // 降级链收敛：Layer 3/4 均无接收方快速失败后，任务应标记为 failed
    const tasks = await getAllDownloadTasks()
    expect(tasks[0].status).toBe('failed')
  })
})
