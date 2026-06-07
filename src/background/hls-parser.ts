/**
 * HLS m3u8 播放列表解析器
 * 支持主播放列表（master playlist）和媒体播放列表（media playlist）
 */

export interface HlsEncryption {
  method: string
  keyUrl: string
  iv?: Uint8Array
}

export interface HlsSegment {
  url: string
  duration: number
  key?: {
    method: string
    iv?: Uint8Array
  }
}

export interface HlsMediaPlaylist {
  type: 'media'
  targetDuration: number
  segments: HlsSegment[]
  encryption?: HlsEncryption
  mapUri?: string
  endList: boolean
}

export interface HlsVariant {
  bandwidth: number
  resolution?: { width: number; height: number }
  url: string
}

export interface HlsMasterPlaylist {
  type: 'master'
  variants: HlsVariant[]
}

/**
 * 解析 m3u8 文本为结构化的播放列表对象
 */
export function parseM3u8(
  content: string,
  baseUrl: string
): HlsMasterPlaylist | HlsMediaPlaylist {
  const lines = content.split(/\r?\n/).map((l) => l.trim())

  let isMaster = false
  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      isMaster = true
      break
    }
  }

  if (isMaster) {
    return parseMasterPlaylist(lines, baseUrl)
  }
  return parseMediaPlaylist(lines, baseUrl)
}

/**
 * 选择最高带宽的变体流
 */
export function selectVariant(master: HlsMasterPlaylist): HlsVariant {
  return master.variants.reduce((best, v) =>
    v.bandwidth > best.bandwidth ? v : best
  )
}

function parseMasterPlaylist(
  lines: string[],
  baseUrl: string
): HlsMasterPlaylist {
  const variants: HlsVariant[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue

    const attrs = parseAttributes(line.substring(17))
    const bandwidth = parseInt(attrs['BANDWIDTH'] || '0', 10)
    const resolution = attrs['RESOLUTION'] ? parseResolution(attrs['RESOLUTION']) : undefined

    // 下一行是变体 URL
    const nextLine = lines[i + 1]
    if (!nextLine || nextLine.startsWith('#')) continue

    variants.push({
      bandwidth,
      resolution,
      url: resolveUrl(nextLine, baseUrl),
    })
  }

  return { type: 'master', variants }
}

function parseMediaPlaylist(
  lines: string[],
  baseUrl: string
): HlsMediaPlaylist {
  let targetDuration = 0
  const segments: HlsSegment[] = []
  let encryption: HlsEncryption | undefined
  let mapUri: string | undefined
  let endList = false
  let segmentIndex = 0

  let currentDuration = 0
  let currentEncryption: HlsEncryption | undefined = encryption

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.substring(22), 10)
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.substring(11))
      const method = attrs['METHOD'] || ''
      if (method === 'NONE') {
        currentEncryption = undefined
      } else {
        const keyUrl = attrs['URI'] ? unquote(attrs['URI']) : ''
        let iv: Uint8Array | undefined
        if (attrs['IV']) {
          iv = parseHexIv(attrs['IV'])
        }
        currentEncryption = {
          method,
          keyUrl: resolveUrl(keyUrl, baseUrl),
          iv,
        }
      }
      encryption = currentEncryption
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.substring(11))
      if (attrs['URI']) {
        mapUri = resolveUrl(unquote(attrs['URI']), baseUrl)
      }
    } else if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',')
      currentDuration = parseFloat(
        commaIdx > 0 ? line.substring(8, commaIdx) : line.substring(8)
      )
    } else if (line === '#EXT-X-ENDLIST') {
      endList = true
    } else if (line && !line.startsWith('#')) {
      // 这是一个分片 URL
      if (currentDuration > 0) {
        let segIv: Uint8Array | undefined
        if (currentEncryption) {
          if (currentEncryption.iv) {
            segIv = currentEncryption.iv
          } else {
            segIv = buildSequenceIv(segmentIndex)
          }
        }

        segments.push({
          url: resolveUrl(line, baseUrl),
          duration: currentDuration,
          key: currentEncryption
            ? { method: currentEncryption.method, iv: segIv }
            : undefined,
        })
        segmentIndex++
        currentDuration = 0
      }
    }
  }

  return { type: 'media', targetDuration, segments, encryption, mapUri, endList }
}

// ===== 工具函数 =====

function parseAttributes(attrString: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(attrString)) !== null) {
    result[match[1]] = match[2] !== undefined ? match[2] : match[3]
  }
  return result
}

function parseResolution(res: string): { width: number; height: number } {
  const parts = res.split('x')
  return { width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) }
}

function unquote(str: string): string {
  return str.replace(/^"|"$/g, '')
}

function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

function parseHexIv(hex: string): Uint8Array {
  const cleaned = hex.replace(/^0x/i, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16 && i * 2 < cleaned.length; i++) {
    bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function buildSequenceIv(index: number): Uint8Array {
  const iv = new Uint8Array(16)
  const view = new DataView(iv.buffer)
  view.setUint32(12, index, false) // big-endian at last 4 bytes
  return iv
}
