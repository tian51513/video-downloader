import { describe, it, expect, vi } from 'vitest'

// Mock chrome before importing download-manager (it references chrome at module top level)
vi.stubGlobal('chrome', {
  downloads: {
    onDeterminingFilename: { addListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(),
    getViews: vi.fn(() => []),
    getURL: vi.fn((path) => `chrome-extension://fake-id/${path}`),
    lastError: undefined,
  },
  declarativeNetRequest: {
    updateSessionRules: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
  },
})

vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

const { buildDownloadFilename, looksLikeFallback, extractPageName } = await import('../background/download-manager')

describe('buildDownloadFilename', () => {
  it('uses video title as filename for 85po.com video', () => {
    const video = {
      id: 'test',
      url: 'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      title: 'Ｍｒ．りお',
      format: 'mp4',
      pageUrl: 'https://www.85po.com/v/21417/ri-o/',
      domain: 'www.85po.com',
    }

    const filename = buildDownloadFilename(video)

    // 核心行为：另存为时使用页面视频名称，而非服务器 Content-Disposition 的 "21417"
    expect(filename).toBe('Ｍｒ．りお.mp4')
  })

  it('falls back to page name when title is a numeric ID like Content-Disposition', () => {
    const video = {
      id: 'test',
      url: 'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      title: '21417', // 来自 Content-Disposition 的 fallback 名称
      format: 'mp4',
      pageUrl: 'https://www.85po.com/v/21417/ri-o/',
      domain: 'www.85po.com',
    }

    const filename = buildDownloadFilename(video)

    // "21417" 是 fallback → 从 URL 提取 "ri o"（连字符被替换为空格）
    expect(filename).toBe('ri o.mp4')
  })

  it('falls back to page name when title is empty', () => {
    const video = {
      id: 'test',
      url: 'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      title: '',
      format: 'mp4',
      pageUrl: 'https://www.85po.com/v/21417/ri-o/',
      domain: 'www.85po.com',
    }

    const filename = buildDownloadFilename(video)

    expect(filename).toBe('ri o.mp4')
  })

  it('preserves full-width Japanese characters after sanitization', () => {
    const video = {
      id: 'test',
      url: 'https://example.com/video.mp4',
      title: 'Ｍｒ．りお',
      format: 'mp4',
      pageUrl: 'https://example.com/',
      domain: 'example.com',
    }

    const filename = buildDownloadFilename(video)

    expect(filename).toContain('Ｍｒ．りお')
  })
})

describe('looksLikeFallback', () => {
  it('detects pure numeric IDs (4+ digits) as fallback', () => {
    expect(looksLikeFallback('21417')).toBe(true)
    expect(looksLikeFallback('1234')).toBe(true)
    expect(looksLikeFallback('123456')).toBe(true)
  })

  it('does NOT flag meaningful titles as fallback', () => {
    expect(looksLikeFallback('Ｍｒ．りお')).toBe(false)
    expect(looksLikeFallback('My Video Title')).toBe(false)
    expect(looksLikeFallback('Video 2024')).toBe(false)
  })

  it('detects auto-generated HLS titles', () => {
    expect(looksLikeFallback('hls_12345')).toBe(true)
    expect(looksLikeFallback('video_12345')).toBe(true)
  })
})

describe('extractPageName', () => {
  it('extracts meaningful name from 85po.com URL', () => {
    expect(extractPageName('https://www.85po.com/v/21417/ri-o/')).toBe('ri o')
  })

  it('extracts name from simple URL path', () => {
    expect(extractPageName('https://example.com/videos/my-cool-video')).toBe('my cool video')
  })
})
