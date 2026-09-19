import { describe, it, expect, vi } from 'vitest'
import { looksLikeFallback, cleanSiteTitleSuffix, extractNameFromUrl } from '../background/title-utils'
import { createChromeMock } from './chrome-mock'

// chrome stub（download-manager 模块顶层注册 onDeterminingFilename 监听）
vi.stubGlobal('chrome', createChromeMock().chrome)

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

vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

const { buildDownloadFileName } = await import('../background/download-manager')

describe('buildDownloadFileName（当前真实实现：命名模板 + 扩展名）', () => {
  it('默认模板 {name}.{format}：标题 + 扩展名', () => {
    expect(buildDownloadFileName('Ｍｒ．りお', '.mp4')).toBe('Ｍｒ．りお.mp4')
  })

  it('标题自带的扩展名被剥离，不产生双扩展名', () => {
    expect(buildDownloadFileName('clip.mp4', '.mp4')).toBe('clip.mp4')
    expect(buildDownloadFileName('my.video', '.mp4')).toBe('my.mp4')
  })

  it('扩展名不带点时自动补点', () => {
    expect(buildDownloadFileName('clip', 'mp4')).toBe('clip.mp4')
  })

  it('清理文件系统非法字符', () => {
    expect(buildDownloadFileName('a/b:c*d?"<>|e', '.mp4')).toBe('a_b_c_d_____e.mp4')
  })

  it('空标题回退为 download', () => {
    expect(buildDownloadFileName('', '.mp4')).toBe('download.mp4')
  })
})

describe('looksLikeFallback（标题兜底判定）', () => {
  it('空标题与自动生成模式判定为回退值', () => {
    expect(looksLikeFallback('')).toBe(true)
    expect(looksLikeFallback('hls_12345')).toBe(true)
    expect(looksLikeFallback('video_12345')).toBe(true)
    expect(looksLikeFallback('123456')).toBe(true) // 6 位以上纯数字
    expect(looksLikeFallback('abc123_42')).toBe(true) // hash 类 ID
    expect(looksLikeFallback('site_20260101120000')).toBe(true) // domain_timestamp
    expect(
      looksLikeFallback('123e4567-e89b-12d3-a456-426614174000')
    ).toBe(true) // UUID
  })

  it('有语义的标题不判定为回退值', () => {
    expect(looksLikeFallback('Ｍｒ．りお')).toBe(false)
    expect(looksLikeFallback('My Video Title')).toBe(false)
    expect(looksLikeFallback('Video 2024')).toBe(false)
    // 注意：5 位纯数字（如 Content-Disposition 的 "21417"）在当前实现中不算回退值
    expect(looksLikeFallback('21417')).toBe(false)
  })
})

describe('cleanSiteTitleSuffix（站名后缀清理）', () => {
  it('"标题 – tags | site" 模式取标题部分', () => {
    expect(cleanSiteTitleSuffix('完整视频标题 – tags | Site')).toBe('完整视频标题')
  })

  it('"标题 | site" 模式取标题部分', () => {
    expect(cleanSiteTitleSuffix('视频标题 | Site')).toBe('视频标题')
  })

  it('无 " | " 模式时保持原样（og:title 通常已干净）', () => {
    expect(cleanSiteTitleSuffix('Plain Title')).toBe('Plain Title')
  })

  it('管道符前过短（≤3 字符）时不动标题', () => {
    expect(cleanSiteTitleSuffix('ab | Site')).toBe('ab | Site')
  })
})

describe('extractNameFromUrl（URL 路径名提取）', () => {
  it('取最后一段路径，连字符转空格', () => {
    expect(extractNameFromUrl('https://www.85po.com/v/21417/ri-o/')).toBe('ri o')
    expect(extractNameFromUrl('https://example.com/videos/my-cool-video')).toBe('my cool video')
  })

  it('最后一段是纯数字时回退到域名', () => {
    expect(extractNameFromUrl('https://example.com/v/21417/')).toBe('example.com')
  })

  it('非法 URL 返回空串', () => {
    expect(extractNameFromUrl('not-a-url')).toBe('')
  })
})
