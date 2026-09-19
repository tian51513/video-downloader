import { describe, it, expect } from 'vitest'
import {
  parseAttributes,
  resolveUrl,
  isM3u8Master,
  parseM3u8Master,
  parseM3u8MediaDuration,
  estimateFileSize,
  collectSegmentUrls,
  type M3u8Variant,
} from '../shared/hls-sniff'

/**
 * m3u8 嗅探解析器测试（src/shared/hls-sniff.ts —— 真实模块）
 *
 * 历史上这些函数内联在 injector-script.ts 的闭包里无法被 import，
 * 测试文件靠手工镜像同步（"修改时必须同步更新"）。injector 改为
 * esbuild 构建期打包后共享逻辑抽出为本模块，测试直接 import。
 */

describe('m3u8 内联解析器', () => {
  describe('parseAttributes', () => {
    it('解析 BANDWIDTH 和 RESOLUTION', () => {
      const attrs = parseAttributes('BANDWIDTH=1280000,RESOLUTION=720x480')
      expect(attrs['BANDWIDTH']).toBe('1280000')
      expect(attrs['RESOLUTION']).toBe('720x480')
    })

    it('解析带引号的 URI 属性', () => {
      const attrs = parseAttributes('BANDWIDTH=1280000,CODECS="avc1.640029,mp4a.40.2"')
      expect(attrs['BANDWIDTH']).toBe('1280000')
      expect(attrs['CODECS']).toBe('avc1.640029,mp4a.40.2')
    })

    it('解析带下划线的属性名', () => {
      const attrs = parseAttributes('AVERAGE-BANDWIDTH=1000000')
      expect(attrs['AVERAGE-BANDWIDTH']).toBe('1000000')
    })

    it('空字符串返回空对象', () => {
      expect(parseAttributes('')).toEqual({})
    })
  })

  describe('resolveUrl', () => {
    it('解析相对路径为绝对 URL', () => {
      expect(resolveUrl('720p.m3u8', 'https://cdn.example.com/video/master.m3u8'))
        .toBe('https://cdn.example.com/video/720p.m3u8')
    })

    it('解析绝对路径为不变', () => {
      expect(resolveUrl('https://other.cdn.com/v.m3u8', 'https://cdn.example.com/master.m3u8'))
        .toBe('https://other.cdn.com/v.m3u8')
    })

    it('解析根相对路径', () => {
      expect(resolveUrl('/static/v.m3u8', 'https://cdn.example.com/video/master.m3u8'))
        .toBe('https://cdn.example.com/static/v.m3u8')
    })
  })

  describe('parseM3u8Master', () => {
    it('解析典型的 master playlist 提取所有变体', () => {
      const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1770000,RESOLUTION=1280x720
https://cdn.example.com/720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1026000,RESOLUTION=854x480
https://cdn.example.com/480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=404000,RESOLUTION=426x240
https://cdn.example.com/240p.m3u8`
      const variants = parseM3u8Master(content, 'https://example.com/master.m3u8')

      expect(variants).toHaveLength(3)
      // 第一条: 720p
      expect(variants[0].width).toBe(1280)
      expect(variants[0].height).toBe(720)
      expect(variants[0].bandwidth).toBe(1770000)
      expect(variants[0].url).toBe('https://cdn.example.com/720p.m3u8')
      // 第二条: 480p
      expect(variants[1].width).toBe(854)
      expect(variants[1].height).toBe(480)
      // 第三条: 240p
      expect(variants[2].bandwidth).toBe(404000)
    })

    it('支持相对路径变体 URL', () => {
      const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
360p/index.m3u8`
      const variants = parseM3u8Master(content, 'https://cdn.example.com/video/master.m3u8')

      expect(variants).toHaveLength(1)
      expect(variants[0].url).toBe('https://cdn.example.com/video/360p/index.m3u8')
    })

    it('没有 RESOLUTION 属性时 width/height 为 0', () => {
      const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000
video.m3u8`
      const variants = parseM3u8Master(content, 'https://example.com/master.m3u8')

      expect(variants).toHaveLength(1)
      expect(variants[0].width).toBe(0)
      expect(variants[0].height).toBe(0)
      expect(variants[0].bandwidth).toBe(500000)
    })

    it('空内容返回空数组', () => {
      expect(parseM3u8Master('', 'https://example.com/m.m3u8')).toEqual([])
    })

    it('media playlist（无 #EXT-X-STREAM-INF）返回空数组', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment0.ts
#EXT-X-ENDLIST`
      expect(parseM3u8Master(content, 'https://example.com/m.m3u8')).toEqual([])
    })
  })

  describe('parseM3u8MediaDuration', () => {
    it('提取 TARGETDURATION 值', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.5,
seg0.ts
#EXT-X-ENDLIST`
      expect(parseM3u8MediaDuration(content)).toBe(10)
    })

    it('没有 TARGETDURATION 返回 0', () => {
      expect(parseM3u8MediaDuration('random text')).toBe(0)
    })
  })

  describe('isM3u8Master', () => {
    it('master playlist 返回 true', () => {
      expect(isM3u8Master('#EXT-X-STREAM-INF:BANDWIDTH=1000')).toBe(true)
    })

    it('media playlist 返回 false', () => {
      expect(isM3u8Master('#EXT-X-TARGETDURATION:10')).toBe(false)
    })
  })

  describe('estimateFileSize', () => {
    it('计算预估文件大小（bitrate bps, duration 秒）', () => {
      // 1 Mbps * 600s = 1,000,000 * 600 / 8 = 75,000,000 bytes
      expect(estimateFileSize(1_000_000, 600)).toBe(75_000_000)
    })

    it('0 bitrate 返回 0', () => {
      expect(estimateFileSize(0, 600)).toBe(0)
    })

    it('0 duration 返回 0', () => {
      expect(estimateFileSize(1_000_000, 0)).toBe(0)
    })
  })

  describe('collectSegmentUrls（HLS 分片抑制登记）', () => {
    // 复现 acgxmh.com 场景：hls.js 逐分片加载 seg_*.ts 被网络钩子
    // 逐个上报成独立 ts 视频，版本面板被分块文件淹没——m3u8 解析时
    // 登记分片 URL，后续命中即抑制上报
    const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:7.533333,
seg_00000.ts
#EXTINF:8.333333,
seg_00001.ts
#EXT-X-ENDLIST
`

    it('相对分片名解析为绝对 URL（基准带查询参数时查询不传染）', () => {
      const base = 'https://m.acgnfl.com/26/08/c53/853234/fhd/index.m3u8?m=abc&t=123&from=%2F26%2Fmaster.m3u8'
      const urls = collectSegmentUrls(PLAYLIST, base)
      expect(urls).toEqual([
        'https://m.acgnfl.com/26/08/c53/853234/fhd/seg_00000.ts',
        'https://m.acgnfl.com/26/08/c53/853234/fhd/seg_00001.ts',
      ])
    })

    it('绝对分片 URL 原样收集', () => {
      const urls = collectSegmentUrls(
        '#EXTM3U\n#EXTINF:6,\nhttps://cdn.test/abs/seg1.ts\n',
        'https://other.test/playlist.m3u8'
      )
      expect(urls).toEqual(['https://cdn.test/abs/seg1.ts'])
    })

    it('#EXT-X-MAP 的 init segment 一并登记（同为流组成部分）', () => {
      const urls = collectSegmentUrls(
        '#EXTM3U\n#EXT-X-MAP:URI="init-v1.mp4"\n#EXTINF:6,\nseg1.m4s\n',
        'https://cdn.test/hls/index.m3u8'
      )
      expect(urls).toEqual(['https://cdn.test/hls/init-v1.mp4', 'https://cdn.test/hls/seg1.m4s'])
    })

    it('空行与纯标签行不产出', () => {
      expect(collectSegmentUrls('#EXTM3U\n\n#EXT-X-ENDLIST\n', 'https://cdn.test/i.m3u8')).toEqual([])
    })
  })
})
