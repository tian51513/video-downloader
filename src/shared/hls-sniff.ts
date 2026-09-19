/**
 * m3u8 嗅探级解析（检测路径用，纯函数）
 *
 * 与 background/hls-parser.ts 的分工：这里是检测时的轻量解析（master 变体
 * 提取 / 时长嗅探 / 体积预估），那边是下载时的完整解析（加密、#EXT-X-MAP、
 * 分片收集）。此前本逻辑内联在 injector-script.ts 中，测试文件靠手工镜像
 * 同步——现在测试直接 import 本模块。
 */

export interface M3u8Variant {
  bandwidth: number
  width: number
  height: number
  url: string
}

export function parseAttributes(attrString: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(attrString)) !== null) {
    result[match[1]] = match[2] !== undefined ? match[2] : match[3]
  }
  return result
}

export function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

export function isM3u8Master(content: string): boolean {
  return content.includes('#EXT-X-STREAM-INF')
}

export function parseM3u8Master(content: string, baseUrl: string): M3u8Variant[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim())
  const variants: M3u8Variant[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue
    const attrs = parseAttributes(line.substring(17))
    const bandwidth = parseInt(attrs['BANDWIDTH'] || '0', 10)
    let width = 0,
      height = 0
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

export function parseM3u8MediaDuration(content: string): number {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-TARGETDURATION:')) {
      return parseInt(lines[i].substring(22), 10) || 0
    }
  }
  return 0
}

/**
 * 提取 media playlist 的分片绝对 URL（含 #EXT-X-MAP 的 init segment）。
 * 用途：HLS 播放器（hls.js 等）逐分片加载时，网络钩子会把每个分片当
 * 独立 ts/m4s 视频上报、淹没版本面板——解析播放列表时先登记分片集合，
 * 后续按 URL 命中即抑制上报。
 */
export function collectSegmentUrls(content: string, baseUrl: string): string[] {
  const urls: string[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-MAP:')) {
        const match = line.match(/URI="([^"]+)"/)
        if (match?.[1]) urls.push(resolveUrl(match[1], baseUrl))
      }
      continue
    }
    urls.push(resolveUrl(line, baseUrl))
  }
  return urls
}

export function estimateFileSize(bitrate: number, durationSeconds: number): number {
  return Math.round((bitrate * durationSeconds) / 8)
}
