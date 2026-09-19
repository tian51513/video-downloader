import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DownloadTask } from '../types'

// Mock Chrome API (download-manager 在模块顶层注册 onDeterminingFilename 监听)
const updateRuleCalls: any[] = []

vi.stubGlobal('chrome', {
  declarativeNetRequest: {
    updateSessionRules: vi.fn((args: any) => {
      updateRuleCalls.push(args)
      return Promise.resolve()
    }),
  },
  downloads: {
    onDeterminingFilename: { addListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve({})),
    getURL: vi.fn((path: string) => path),
    lastError: undefined,
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
  },
})

vi.mock('../utils/storage', () => ({
  saveDownloads: vi.fn(() => Promise.resolve()),
  getDownloads: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../background/settings', () => ({
  getFullSettings: vi.fn(() => Promise.resolve({ downloadSettings: {} })),
  initDefaultSettings: vi.fn(() => Promise.resolve()),
}))

vi.mock('../utils/offscreen-blob', () => ({
  fetchAndDownload: vi.fn(),
  ensureOffscreen: vi.fn(),
}))

vi.mock('../background/hls-downloader', () => ({
  downloadHls: vi.fn(),
}))

const { setupDownloadRules } = await import('../background/download-manager')

const makeTask = (url: string, pageUrl: string): DownloadTask =>
  ({
    id: `t_${Math.random().toString(36).slice(2, 8)}`,
    video: { url, pageUrl },
    status: 'pending',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    downloader: 'chrome',
  }) as unknown as DownloadTask

describe('setupDownloadRules（DNR 会话规则：Referer 伪造 + Content-Disposition 移除）', () => {
  beforeEach(() => {
    updateRuleCalls.length = 0
    vi.clearAllMocks()
  })

  it('添加移除 Content-Disposition 响应头的规则', async () => {
    await setupDownloadRules(makeTask(
      'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      'https://www.85po.com/v/21417/ri-o/'
    ))

    expect(updateRuleCalls.length).toBe(1)
    const rule = updateRuleCalls[0].addRules[0]
    expect(
      rule.action.responseHeaders.some(
        (h: any) => h.header === 'Content-Disposition' && h.operation === 'remove'
      )
    ).toBe(true)
  })

  it('添加设置 Referer 请求头的规则，值为页面 URL', async () => {
    await setupDownloadRules(makeTask(
      'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      'https://www.85po.com/v/21417/ri-o/'
    ))

    const rule = updateRuleCalls[0].addRules[0]
    expect(
      rule.action.requestHeaders.some(
        (h: any) => h.header === 'Referer' && h.operation === 'set'
      )
    ).toBe(true)
    expect(rule.action.requestHeaders[0].value).toBe('https://www.85po.com/v/21417/ri-o/')
  })

  it('规则 ID 为正整数且 resourceTypes 覆盖 chrome.downloads 请求', async () => {
    await setupDownloadRules(makeTask('https://example.com/video.mp4', 'https://example.com/'))

    const rule = updateRuleCalls[0].addRules[0]
    expect(Number.isInteger(rule.id)).toBe(true)
    expect(rule.id).toBeGreaterThan(0)
    expect(rule.condition.resourceTypes).toContain('other')
  })

  it('blob: URL 不添加任何规则（URL 解析失败被跳过）', async () => {
    await setupDownloadRules(makeTask('blob:uuid-here', 'https://example.com/'))

    const addRuleCalls = updateRuleCalls.filter((c: any) => c.addRules?.length > 0)
    expect(addRuleCalls.length).toBe(0)
  })
})
