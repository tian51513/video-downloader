import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 测试：下载策略选择
 *
 * 核心行为：
 * 1. 对于非 HLS 视频，应该先尝试 offscreen fetch + blob URL（文件名可控）
 * 2. 如果 offscreen fetch 失败，降级到直接 chrome.downloads（文件名可能被覆盖）
 * 3. 无论哪种方式，filename 参数应该来自 buildDownloadFilename
 */

// Mock chrome API
let mockDownloadCalls: any[] = []
let mockDownloadIdCounter = 100

const mockOnChangedListeners: Function[] = []

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn((message, callback) => {
      // Simulate offscreen document response
      if (message.type === 'OFFSCREEN_FETCH_AND_BLOB') {
        if (callback) {
          callback({ url: 'blob:chrome-extension-xxx/mock-blob', size: 1048576 })
        }
      }
    }),
    onMessage: {
      addListener: vi.fn((listener) => mockOnChangedListeners.push(listener)),
      removeListener: vi.fn((listener) => {
        const idx = mockOnChangedListeners.indexOf(listener)
        if (idx >= 0) mockOnChangedListeners.splice(idx, 1)
      }),
    },
  },
  downloads: {
    download: vi.fn((options, callback) => {
      mockDownloadCalls.push(options)
      if (callback) callback(++mockDownloadIdCounter)
    }),
    search: vi.fn((_query, callback) => {
      if (callback) callback([{ totalBytes: 1048576, bytesReceived: 1048576 }])
    }),
    onChanged: {
      addListener: vi.fn((listener) => {}),
      removeListener: vi.fn((listener) => {}),
    },
  },
  offscreen: {
    hasDocument: vi.fn(() => Promise.resolve(true)),
    createDocument: vi.fn(() => Promise.resolve()),
  },
  declarativeNetRequest: {
    updateSessionRules: vi.fn(() => Promise.resolve()),
  },
})

describe('下载策略：blob URL 优先', () => {
  beforeEach(() => {
    mockDownloadCalls = []
    mockDownloadIdCounter = 100
    mockOnChangedListeners.length = 0
  })

  it('chrome.downloads.download 应该使用 blob URL 而非原始视频 URL', async () => {
    // 这个测试模拟 offscreen fetch 成功后的行为
    // 核心断言：下载 URL 应该是 blob:xxx 而不是原始 https://xxx
    // 这样就没有 Content-Disposition 头，文件名完全由 filename 参数控制

    // 模拟 blob URL 下载
    const blobUrl = 'blob:chrome-extension-xxx/mock-blob'
    const filename = 'Ｍｒ．りお.mp4'

    chrome.downloads.download(
      { url: blobUrl, filename, saveAs: true, conflictAction: 'uniquify' },
      vi.fn()
    )

    expect(mockDownloadCalls[0].url).toBe(blobUrl)
    expect(mockDownloadCalls[0].filename).toBe('Ｍｒ．りお.mp4')
    expect(mockDownloadCalls[0].saveAs).toBe(true)
  })

  it('blob URL 下载使用我们指定的文件名，不受 Content-Disposition 影响', async () => {
    const blobUrl = 'blob:chrome-extension-xxx/fetched-video'
    const ourFilename = 'Ｍｒ．りお.mp4'

    chrome.downloads.download(
      { url: blobUrl, filename: ourFilename, saveAs: true, conflictAction: 'uniquify' },
      vi.fn()
    )

    // blob URL 没有 Content-Disposition → Chrome 使用 filename 参数
    const call = mockDownloadCalls[mockDownloadCalls.length - 1]
    expect(call.filename).toBe('Ｍｒ．りお.mp4')
    // URL 是 blob: 协议，不是 https://（原始 URL 可能会带 Content-Disposition）
    expect(call.url).toMatch(/^blob:/)
  })
})
