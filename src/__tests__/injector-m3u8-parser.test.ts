import { describe, it, expect } from 'vitest'

/**
 * injector-script.ts 中内联 m3u8 解析函数的测试。
 *
 * 由于 injector-script.ts 运行在 MAIN world，无法 import，
 * 这里提取纯函数副本进行单元测试，确保解析逻辑正确。
 *
 * 这些函数是 injector-script.ts 中同名函数的镜像——
 * 修改时必须同步更新。
 */

// ===== 从 injector-script.ts 镜像的纯函数 =====

function parseAttributes(attrString: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(attrString)) !== null) {
    result[match[1]] = match[2] !== undefined ? match[2] : match[3]
  }
  return result
}

function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

interface M3u8Variant {
  bandwidth: number
  width: number
  height: number
  url: string
}

function parseM3u8Master(content: string, baseUrl: string): M3u8Variant[] {
  const lines = content.split(/\r?\n/).map(l => l.trim())
  const variants: M3u8Variant[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue
    const attrs = parseAttributes(line.substring(17))
    const bandwidth = parseInt(attrs['BANDWIDTH'] || '0', 10)
    let width = 0, height = 0
    if (attrs['RESOLUTION']) {
      const parts = attrs['RESOLUTION'].split('x')
      width = parseInt(parts[0], 10) || 0
      height = parseInt(parts[1], 10) || 0
    }
    const nextLine = lines[i + 1]
    if (!nextLine || nextLine.startsWith('#')) continue
    variants.push({ bandwidth, width, height, url: resolveUrl(nextLine, baseUrl) })
  }
  return variants
}

function parseM3u8MediaDuration(content: string): number {
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      return parseInt(line.substring(22), 10) || 0
    }
  }
  return 0
}

function isM3u8Master(content: string): boolean {
  return content.includes('#EXT-X-STREAM-INF')
}

function estimateFileSize(bitrate: number, durationSeconds: number): number {
  return Math.round(bitrate * durationSeconds / 8)
}

// ===== Tests =====

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
})
