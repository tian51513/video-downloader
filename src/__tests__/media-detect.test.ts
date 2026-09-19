import { describe, it, expect } from 'vitest'
import { normalizeReportUrl, detectFormatFromUrl, detectFormatFromContentType, isMediaRequest } from '../shared/media-detect'

/**
 * 测试：共享媒体检测模块
 *
 * normalizeReportUrl 是"相对 URL 上报"缺陷的核心修复（huangguo.video 站点
 * 播放器用相对路径 fetch m3u8，网络钩子捕获原始参数直接上报，SW 中 fetch
 * 因缺少基准地址抛 TypeError: Failed to fetch）。
 */

describe('normalizeReportUrl', () => {
  const PAGE = 'https://huangguo.video/video/foqxppym'

  it('相对路径相对页面地址解析为绝对 URL', () => {
    expect(normalizeReportUrl('480p/index.m3u8?n=abc', PAGE))
      .toBe('https://huangguo.video/video/480p/index.m3u8?n=abc')
    expect(normalizeReportUrl('/media/x/master.m3u8', PAGE))
      .toBe('https://huangguo.video/media/x/master.m3u8')
  })

  it('绝对 URL 原样保留', () => {
    const url = 'https://cdn.example.com/video/index.m3u8?token=1'
    expect(normalizeReportUrl(url, PAGE)).toBe(url)
  })

  it('blob: URL 原样保留', () => {
    const url = 'blob:https://page.test/0123-4567'
    expect(normalizeReportUrl(url, PAGE)).toBe(url)
  })

  it('基准地址无效时原样返回（不抛异常）', () => {
    expect(normalizeReportUrl('480p/index.m3u8', 'not-a-url')).toBe('480p/index.m3u8')
  })
})

describe('detectFormatFromUrl / detectFormatFromContentType', () => {
  it('URL 后缀检测（含查询参数与尾斜杠）', () => {
    expect(detectFormatFromUrl('https://x.com/a.mp4?token=1')).toBe('mp4')
    expect(detectFormatFromUrl('https://x.com/a/b.m3u8')).toBe('hls')
    expect(detectFormatFromUrl('https://x.com/a.mp3')).toBe('mp3')
    expect(detectFormatFromUrl('https://x.com/a.MOV')).toBe('mov')
    expect(detectFormatFromUrl('https://x.com/a.mp4/')).toBe('mp4')
    expect(detectFormatFromUrl('https://x.com/a.txt')).toBeNull()
  })

  it('Content-Type 检测（含 charset 参数与音频 MIME）', () => {
    expect(detectFormatFromContentType('application/vnd.apple.mpegurl')).toBe('hls')
    expect(detectFormatFromContentType('application/x-mpegurl; charset=utf-8')).toBe('hls')
    expect(detectFormatFromContentType('application/dash+xml')).toBe('dash')
    expect(detectFormatFromContentType('audio/mpeg')).toBe('mp3')
    expect(detectFormatFromContentType('text/html')).toBeNull()
  })

  it('isMediaRequest：URL 或 Content-Type 任一命中', () => {
    expect(isMediaRequest('https://x.com/a.mp4')).toBe(true)
    expect(isMediaRequest('https://x.com/a', 'audio/mp4')).toBe(true)
    expect(isMediaRequest('https://x.com/a', 'text/html')).toBe(false)
  })
})
