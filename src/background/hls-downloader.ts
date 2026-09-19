/**
 * HLS 下载编排器
 * 解析 m3u8 → 并行下载分片 → 解密 → 封装为 MP4 → 保存
 */

import type { DownloadTask, DownloadStatus } from '../types'
import { getSettings as getFullSettings } from '../utils/storage'
import { sanitizeName } from '../utils/sanitize'
import { looksLikeFallback, cleanSiteTitleSuffix, extractNameFromUrl } from './title-utils'
import { getDirectoryHandle, DOWNLOAD_DIR } from '../utils/directory-handle'
import { idbPut } from '../utils/idb'
import {
  parseM3u8,
  selectVariant,
  type HlsMediaPlaylist,
} from './hls-parser'
import muxjs from 'mux.js'

const SAVE_DB_NAME = 'vd-pending-saves'
const SAVE_STORE_NAME = 'pending-saves'

export async function downloadHls(
  task: DownloadTask,
  signal: AbortSignal,
  concurrency: number,
  onProgress: (progress: number, speed: number, downloadedBytes: number) => void,
  onStatusChange: (status: DownloadStatus, error?: string) => void
): Promise<{ chromeDownloadId?: number; savedFileName?: string }> {
  const settings = await getFullSettings()
  const retryCount = settings.downloadSettings.retryCount || 3
  const timeout = settings.downloadSettings.timeout || 30000
  const askSaveLocation = settings.downloadSettings.askSaveLocation || false

  // Step 1: 获取并解析 m3u8（status 已由 downloadHLS wrapper 设置，不再重复）
  const referrer = task.video.pageUrl || ''
  console.log(`[HLS] 开始下载: ${task.video.title || task.id}, URL: ${task.video.url}, referrer: ${referrer}`)

  // 存量防御：srcdoc/blob iframe 中的检测层无法解析相对地址（new URL 对
  // 此类基准抛异常），任务可能携带原始相对字符串。SW 侧用 pageUrl 按
  // "替换末段"与"追加末段"两种基准语义构造候选按序尝试（无法预知站点用哪种）
  const candidates = buildRequestCandidates(task.video.url, task.video.pageUrl)
  let m3u8Text = ''
  let requestUrl = candidates[0]
  let lastM3u8Error: unknown
  for (let i = 0; i < candidates.length; i++) {
    try {
      m3u8Text = await fetchWithRetry(
        candidates[i], signal, retryCount, timeout, referrer,
        async (response) => await response.text()
      )
      requestUrl = candidates[i]
      if (candidates.length > 1) {
        console.log(`[HLS] m3u8 候选地址命中 (${i + 1}/${candidates.length}): ${requestUrl}`)
      }
      break
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error
      lastM3u8Error = error
      if (candidates.length > 1) {
        console.warn(`[HLS] m3u8 候选地址失败 (${i + 1}/${candidates.length}): ${candidates[i]} → ${error.message}`)
      }
    }
  }
  if (!m3u8Text) {
    throw new Error(
      `m3u8 获取失败（已试 ${candidates.length} 个地址: ${candidates.join(' | ')}）: ${(lastM3u8Error as any)?.message || lastM3u8Error}`
    )
  }

  let playlist = parseM3u8(m3u8Text, requestUrl)
  console.log(`[HLS] m3u8 解析完成, 类型: ${playlist.type}`)

  // 如果是主播放列表，跟随最高码率变体
  if (playlist.type === 'master') {
    const variant = selectVariant(playlist)
    console.log(`[HLS] 主播放列表，选择变体: ${variant.resolution || ''} ${variant.bandwidth}bps → ${variant.url}`)
    const variantText = await fetchWithRetry(
      variant.url, signal, retryCount, timeout, referrer,
      async (response) => await response.text()
    )
    playlist = parseM3u8(variantText, variant.url)
  }

  if (playlist.type !== 'media') {
    throw new Error('无法解析 m3u8 播放列表')
  }

  const mediaPlaylist: HlsMediaPlaylist = playlist
  const segments = mediaPlaylist.segments

  if (segments.length === 0) {
    throw new Error('无效的 m3u8 播放列表：未找到视频分片')
  }

  console.log(`[HLS] 分片数量: ${segments.length}, 加密: ${mediaPlaylist.encryption?.method || '无'}, mapUri: ${mediaPlaylist.mapUri || '无'}`)

  // Step 2: 并行下载分片
  onProgress(0, 0, 0)
  const segmentConcurrency = Math.min(concurrency || 3, segments.length)
  console.log(`[HLS] 开始下载分片 (并发: ${segmentConcurrency}, 重试: ${retryCount})`)
  const segmentBuffers = await downloadSegments(
    segments,
    signal,
    segmentConcurrency,
    retryCount,
    timeout,
    referrer,
    onProgress,
    (totalBytes) => {
      if (totalBytes > 0) task.totalBytes = totalBytes
    }
  )
  const actualTotal = segmentBuffers.reduce((s, b) => s + b.byteLength, 0)
  console.log(`[HLS] 分片下载完成, 总大小: ${formatBytes(actualTotal)}`)

  // Step 3: AES-128 解密（如需）
  if (mediaPlaylist.encryption && mediaPlaylist.encryption.method === 'AES-128') {
    console.log(`[HLS] 开始 AES-128 解密, 密钥 URL: ${mediaPlaylist.encryption.keyUrl}`)
    onStatusChange('merging')
    await decryptSegments(
      segmentBuffers, segments, mediaPlaylist.encryption.keyUrl,
      signal, referrer, retryCount, timeout
    )
    console.log('[HLS] 解密完成')
  }

  // Step 4: 封装为有效 MP4
  onStatusChange('merging')
  console.log('[HLS] 开始封装 MP4...')
  const mp4Data = await remuxToMp4(segmentBuffers, mediaPlaylist, signal, referrer)
  // 修补 mvhd/mehd 时长与创建时间——init segment 的元数据是占位值，
  // 播放器/资源管理器会据此显示 0 时长与 1904 年日期
  const totalDuration = segments.reduce((sum, seg) => sum + (seg.duration || 0), 0)
  patchMp4Metadata(mp4Data, totalDuration)
  console.log(`[HLS] MP4 封装完成, 大小: ${formatBytes(mp4Data.byteLength)}`)

  // Step 5: 保存
  let rawTitle = task.video.title || ''
  // 尝试从页面获取标题，但仅在当前标题是回退值时才覆盖
  if (task.video.pageUrl && looksLikeFallback(rawTitle)) {
    try {
      const pageTitle = await fetchPageTitle(task.video.pageUrl, signal)
      if (pageTitle && !looksLikeFallback(pageTitle)) {
        console.log(`[HLS] 当前标题是回退值，使用页面标题: "${rawTitle}" -> "${pageTitle}"`)
        rawTitle = pageTitle
      }
    } catch { /* 忽略 */ }
  }
  if (!rawTitle || looksLikeFallback(rawTitle)) {
    const pageName = extractNameFromUrl(task.video.pageUrl)
    if (pageName && pageName.length > rawTitle.length) rawTitle = pageName
  }
  if (!rawTitle) rawTitle = `hls_${Date.now()}`
  rawTitle = rawTitle.replace(/\.(mp4|mkv|webm|flv|avi|ts|mov|wmv|rm|rmvb|m4v|f4v|mp3|wav|m4a|ogg)$/i, '')
  // 清理站点标题后缀（如 " – tags | site"）
  rawTitle = cleanSiteTitleSuffix(rawTitle)
  const baseName = sanitizeName(rawTitle)
  const safeName = baseName || `video_${Date.now()}`
  const filename = `${safeName}.mp4`
  console.log('[HLS] 保存文件名:', filename, '(原始 title:', task.video.title || '(空)', ')')

  // 优先使用用户选择的目录句柄直接写入
  try {
    const dirHandle = await getDirectoryHandle(DOWNLOAD_DIR)
    // 权限预检：浏览器重启后句柄权限会回退，SW 中没有 user activation
    // 无法 requestPermission，直接写入只会得到 NotAllowedError——
    // 未授权时跳过，交给 save-helper 页面引导用户一键重新授权
    let dirPerm: string | undefined
    if (dirHandle) {
      try {
        dirPerm = await (dirHandle as any).queryPermission({ mode: 'readwrite' })
      } catch { dirPerm = 'prompt' }
    }
    if (dirHandle && dirPerm === 'granted') {
      console.log('[HLS] 使用目录句柄直接写入')
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(mp4Data)
      await writable.close()
      console.log(`[HLS] 文件保存成功: ${filename}`)
      return { savedFileName: filename }
    }
    if (dirHandle) {
      console.log('[HLS] 目录句柄权限未授予（重启后会回退），转由保存页引导重新授权')
    }
  } catch (dirError: any) {
    console.warn('[HLS] 目录句柄写入失败，尝试降级方案:', dirError.message)
  }

  // 降级：通过 IndexedDB + 扩展页面触发下载
  console.log('[HLS] 降级方案: IndexedDB + 扩展页面')
  try {
    console.log(`[HLS] 数据大小: ${(mp4Data.byteLength / 1024 / 1024).toFixed(1)} MB`)

    const saveKey = `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await writeToSaveDB(saveKey, mp4Data)
    console.log(`[HLS] 数据已写入 IndexedDB, key: ${saveKey}`)

    const helperUrl = chrome.runtime.getURL(
      `save-helper.html?k=${encodeURIComponent(saveKey)}&n=${encodeURIComponent(filename)}&m=${encodeURIComponent('video/mp4')}&s=0&t=${encodeURIComponent(task.id)}`
    )
    await chrome.tabs.create({ url: helperUrl, active: true })

    console.log(`[HLS] 保存辅助页面已打开`)
    return { savedFileName: filename }
  } catch (downloadError: any) {
    console.error('[HLS] 下载保存失败:', downloadError.name, downloadError.message)
    throw new Error(`无法保存文件: ${downloadError.message}`)
  }
}

// ===== TS/fMP4 → MP4 封装 =====

/**
 * 检测分片格式：TS (0x47) 或 fMP4
 */
function detectSegmentFormat(buffers: ArrayBuffer[]): 'ts' | 'fmp4' | 'unknown' {
  if (buffers.length === 0) return 'unknown'
  const first = new Uint8Array(buffers[0])
  // TS 同步字节 0x47，通常位于 188 字节的整数倍位置
  if (first[0] === 0x47 || (first.length > 188 && first[188] === 0x47)) {
    return 'ts'
  }
  // fMP4 box: 4字节大小 + 4字节类型 ('ftyp'/'moof'/'styp')
  if (first.length >= 8) {
    const boxType = String.fromCharCode(first[4], first[5], first[6], first[7])
    if (boxType === 'ftyp' || boxType === 'moof' || boxType === 'styp') {
      return 'fmp4'
    }
  }
  return 'unknown'
}

/**
 * 将下载的分片封装为有效的 MP4 文件
 * - TS 分片：通过 mux.js 转码为 fMP4
 * - fMP4 分片：下载 init segment 并拼接到媒体分片前
 */
async function remuxToMp4(
  segmentBuffers: ArrayBuffer[],
  playlist: HlsMediaPlaylist,
  signal: AbortSignal,
  referrer?: string
): Promise<ArrayBuffer> {
  const format = detectSegmentFormat(segmentBuffers)
  console.log(`[HLS] 检测到分片格式: ${format}`)

  if (format === 'ts') {
    return remuxTsToMp4(segmentBuffers, signal)
  }

  if (format === 'fmp4') {
    return remuxFmp4(segmentBuffers, playlist, signal, referrer)
  }

  // 未知格式：尝试 mux.js 处理，失败则直接拼接
  try {
    return await remuxTsToMp4(segmentBuffers, signal)
  } catch {
    console.warn('[HLS] mux.js 处理失败，直接拼接原始数据')
    return concatArrayBuffers(segmentBuffers)
  }
}

/**
 * 使用 mux.js 将 MPEG-TS 分片转码为 fMP4
 */
function remuxTsToMp4(buffers: ArrayBuffer[], signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const transmuxer = new muxjs.mp4.Transmuxer()
      const outputParts: Uint8Array[] = []
      let initSegment: Uint8Array | null = null

      transmuxer.on('data', (segment: any) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        if (segment.initSegment && segment.initSegment.byteLength > 0) {
          initSegment = new Uint8Array(segment.initSegment)
        }
        if (segment.data && segment.data.byteLength > 0) {
          outputParts.push(new Uint8Array(segment.data))
        }
      })

      // 逐段推入 transmuxer
      let pushed = 0
      function pushNext() {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        if (pushed >= buffers.length) {
          // 所有分片处理完毕
          try {
            transmuxer.dispose()
          } catch { /* ignore */ }
          const parts: Uint8Array[] = []
          if (initSegment) parts.push(initSegment)
          parts.push(...outputParts)
          if (parts.length === 0) {
            reject(new Error('mux.js 未输出任何数据'))
          } else {
            resolve(concatUint8Arrays(parts))
          }
          return
        }

        try {
          transmuxer.push(new Uint8Array(buffers[pushed]))
          transmuxer.flush()
          pushed++
          // 使用 setTimeout 避免大数据量时阻塞
          setTimeout(pushNext, 0)
        } catch (e: any) {
          try { transmuxer.dispose() } catch { /* ignore */ }
          reject(e)
        }
      }

      pushNext()
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * 将 fMP4 分片与 init segment 合并为完整 MP4
 */
async function remuxFmp4(
  segmentBuffers: ArrayBuffer[],
  playlist: HlsMediaPlaylist,
  signal: AbortSignal,
  referrer?: string
): Promise<ArrayBuffer> {
  let initSegment: ArrayBuffer | null = null

  // 优先从 #EXT-X-MAP 下载 init segment
  if (playlist.mapUri) {
    console.log(`[HLS] 下载 init segment: ${playlist.mapUri}`)
    const fetchOpts: RequestInit = { signal, credentials: 'include' }
    if (referrer) {
      fetchOpts.referrer = referrer
      fetchOpts.referrerPolicy = 'unsafe-url'
    }
    const response = await fetch(playlist.mapUri, fetchOpts)
    if (response.ok) {
      initSegment = await response.arrayBuffer()
    }
  }

  // 检查第一个分片是否自带 init segment（ftyp 开头）
  if (!initSegment && segmentBuffers.length > 0) {
    const first = new Uint8Array(segmentBuffers[0])
    if (first.length >= 8) {
      const boxType = String.fromCharCode(first[4], first[5], first[6], first[7])
      if (boxType === 'ftyp') {
        // 提取 init 部分：从 ftyp 到第一个 moof 之前
        initSegment = extractInitFromSegment(segmentBuffers[0])
        // 第一个分片剩余部分作为媒体数据
        const mediaStart = initSegment.byteLength
        if (mediaStart < segmentBuffers[0].byteLength) {
          segmentBuffers[0] = segmentBuffers[0].slice(mediaStart)
        } else {
          segmentBuffers.shift()
        }
      }
    }
  }

  const parts: ArrayBuffer[] = []
  if (initSegment) {
    parts.push(initSegment)
  }
  parts.push(...segmentBuffers)

  return concatArrayBuffers(parts)
}

/**
 * 从 fMP4 数据中提取 init segment（ftyp + moov，到第一个 moof 之前）
 */
function extractInitFromSegment(data: ArrayBuffer): ArrayBuffer {
  const view = new DataView(data)
  let offset = 0
  while (offset + 8 <= data.byteLength) {
    const boxSize = view.getUint32(offset)
    if (boxSize === 0) break
    const boxType = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    )
    if (boxType === 'moof') {
      // 到达媒体分片起始位置，前面的都是 init segment
      return data.slice(0, offset)
    }
    offset += boxSize
  }
  // 没找到 moof，返回整个数据作为 init segment
  return data.slice(0)
}

function concatUint8Arrays(arrays: Uint8Array[]): ArrayBuffer {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.byteLength
  }
  return result.buffer
}

// ===== IndexedDB 写入（HLS 数据太大不能走消息，先落盘再由 save-helper 页面取走） =====

function writeToSaveDB(key: string, data: ArrayBuffer): Promise<void> {
  return idbPut(SAVE_DB_NAME, SAVE_STORE_NAME, key, data)
}

// ===== 分片下载 =====

async function downloadSegments(
  segments: Array<{ url: string }>,
  signal: AbortSignal,
  concurrency: number,
  retryCount: number,
  timeout: number,
  referrer?: string,
  onProgress?: (progress: number, speed: number, downloadedBytes: number) => void,
  onTotalBytes?: (totalBytes: number) => void
): Promise<ArrayBuffer[]> {
  const results = new Array<ArrayBuffer>(segments.length)
  let nextIndex = 0
  let completedCount = 0
  let totalBytes = 0
  const startTime = Date.now()

  async function worker(): Promise<void> {
    while (nextIndex < segments.length) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const index = nextIndex++
      results[index] = await fetchWithRetry(
        segments[index].url,
        signal,
        retryCount,
        timeout,
        referrer
      )
      completedCount++
      totalBytes += results[index].byteLength

      const progress = (completedCount / segments.length) * 100
      const elapsed = (Date.now() - startTime) / 1000
      const speed = elapsed > 0 ? totalBytes / elapsed : 0
      onProgress(progress, speed, totalBytes)
      onTotalBytes?.(totalBytes)
    }
  }

  const workerCount = Math.min(concurrency, segments.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return results
}

// ===== AES-128 解密 =====

async function decryptSegments(
  buffers: ArrayBuffer[],
  segments: Array<{ key?: { method: string; iv?: Uint8Array } }>,
  keyUrl: string,
  signal: AbortSignal,
  referrer?: string,
  retryCount?: number,
  timeout?: number
): Promise<void> {
  let keyData: ArrayBuffer
  try {
    keyData = await fetchWithRetry(
      keyUrl, signal, retryCount ?? 3, timeout ?? 30000, referrer
    )
  } catch (error: any) {
    throw new Error(`AES-128 密钥获取失败: ${error.message}`)
  }
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, ['decrypt'])

  for (let i = 0; i < buffers.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

    const segKey = segments[i].key
    if (!segKey) continue

    const iv = segKey.iv || new Uint8Array(16)
    // TS 5.7 对 BufferSource 的 ArrayBuffer 泛型要求更严，显式放宽
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, key, buffers[i])
    buffers[i] = decrypted
  }
}

// ===== MP4 元数据修补 =====

/**
 * 修补 fMP4 直拼产物的元数据（原位改写，返回同一 buffer）：
 * init segment 的 mvhd/mehd 时长常为 0/占位值、创建时间为 0（Mac epoch →
 * 资源管理器显示 1904 年），播放器与文件属性据此显示错误时长/日期。
 * 解析失败时静默原样返回（元数据缺陷不影响可播放性，不阻塞保存）。
 */
export function patchMp4Metadata(buffer: ArrayBuffer, totalDurationSec: number): ArrayBuffer {
  if (totalDurationSec <= 0 || buffer.byteLength < 16) return buffer
  const view = new DataView(buffer)
  const MAC_EPOCH_OFFSET = 2082844800 // 1904-01-01 → 1970-01-01 秒差
  const now = Math.floor(Date.now() / 1000) + MAC_EPOCH_OFFSET

  const setU32 = (offset: number, value: number) => {
    try { view.setUint32(offset, value) } catch { /* 越界忽略 */ }
  }
  const setU64 = (offset: number, value: number) => {
    // 时长/时间戳写高 32 位 + 低 32 位（v1 box 的 64 位字段）
    setU32(offset, Math.floor(value / 2 ** 32))
    setU32(offset + 4, value >>> 0)
  }
  const clampDuration = (timescale: number) =>
    Math.min(Math.round(totalDurationSec * timescale), 0xfffffffe)

  // 先取 mvhd timescale（mehd 的时长单位与 mvhd 相同；v0 位于 +12，v1 位于 +20）
  let movieTimescale = 0
  eachBox(view, 0, buffer.byteLength, (type, contentOff, _size) => {
    if (type === 'mvhd' && !movieTimescale) {
      const version = view.getUint8(contentOff)
      movieTimescale = view.getUint32(contentOff + (version === 1 ? 20 : 12))
    }
  })
  if (!movieTimescale) return buffer

  const durationUnits = clampDuration(movieTimescale)
  eachBox(view, 0, buffer.byteLength, (type, contentOff, _size) => {
    const version = view.getUint8(contentOff)
    if (type === 'mvhd') {
      if (version === 1) {
        setU64(contentOff + 4, now) // creation_time
        setU64(contentOff + 12, now) // modification_time
        // timescale@20, duration@24 (64-bit)
        setU64(contentOff + 24, durationUnits)
      } else {
        setU32(contentOff + 4, now)
        setU32(contentOff + 8, now)
        // timescale@12, duration@16 (32-bit)
        setU32(contentOff + 16, durationUnits)
      }
    } else if (type === 'mehd' && movieTimescale) {
      // mvex 内的 fragment 总时长，单位同 mvhd timescale
      if (version === 1) {
        setU64(contentOff + 4, durationUnits)
      } else {
        setU32(contentOff + 4, durationUnits)
      }
    } else if (type === 'tkhd') {
      // 轨道时长，单位同 mvhd timescale（资源管理器逐轨读取）
      if (version === 1) {
        setU64(contentOff + 28, durationUnits)
      } else {
        setU32(contentOff + 20, durationUnits)
      }
    } else if (type === 'mdhd') {
      // 轨道媒体时长：timescale/duration 是各轨道自己的（单位与 mvhd 不同）。
      // 个别播放器（如夸克）优先读 mdhd，漏补会显示 20+ 小时垃圾时长
      if (version === 1) {
        setU64(contentOff + 4, now)
        setU64(contentOff + 12, now)
        const mediaTimescale = view.getUint32(contentOff + 20)
        if (mediaTimescale > 0) {
          setU64(contentOff + 24, clampDuration(mediaTimescale))
        }
      } else {
        setU32(contentOff + 4, now)
        setU32(contentOff + 8, now)
        const mediaTimescale = view.getUint32(contentOff + 12)
        if (mediaTimescale > 0) {
          setU32(contentOff + 16, clampDuration(mediaTimescale))
        }
      }
    }
  })
  return buffer
}

/** 遍历顶层及容器 box（moov/trak/mdia/mvex/minf/stbl），回调 (类型, 内容偏移, 总大小) */
function eachBox(
  view: DataView,
  start: number,
  end: number,
  fn: (type: string, contentOff: number, size: number) => void
): void {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'mvex', 'minf', 'stbl'])
  let off = start
  while (off + 8 <= end) {
    let size = view.getUint32(off)
    const type = String.fromCharCode(
      view.getUint8(off + 4), view.getUint8(off + 5), view.getUint8(off + 6), view.getUint8(off + 7)
    )
    let headerSize = 8
    if (size === 1) {
      if (off + 16 > end) return
      size = view.getUint32(off + 8) * 2 ** 32 + view.getUint32(off + 12)
      headerSize = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < headerSize || off + size > end) return
    fn(type, off + headerSize, size)
    if (CONTAINERS.has(type)) {
      eachBox(view, off + headerSize, off + size, fn)
    }
    off += size
  }
}

// ===== 工具函数 =====

/**
 * 相对 URL 的绝对化候选（见 downloadHls Step 1 注释）：
 * - 绝对 URL 原样返回
 * - 相对 URL 依次尝试 pageUrl 的"替换末段"与"追加末段"两种基准语义
 * - 基准不可解析时回退原始字符串（fetch 会失败，但错误信息带地址可定位）
 */
function buildRequestCandidates(rawUrl: string, pageUrl?: string): string[] {
  if (/^https?:\/\//i.test(rawUrl)) return [rawUrl]
  if (!pageUrl) return [rawUrl]
  const candidates: string[] = []
  const bases = [pageUrl, pageUrl.endsWith('/') ? pageUrl : pageUrl + '/']
  for (const base of bases) {
    try {
      const absolute = new URL(rawUrl, base).href
      if (!candidates.includes(absolute)) candidates.push(absolute)
    } catch { /* 基准不可解析，跳过 */ }
  }
  return candidates.length > 0 ? candidates : [rawUrl]
}

async function fetchWithTimeout(
  url: string,
  signal: AbortSignal,
  timeout: number,
  referrer?: string
): Promise<Response> {
  // 用户取消（pause/cancel 的 AbortController）与超时共同作用在同一 fetch 上。
  // 注意：AbortSignal.timeout() 返回的 signal 没有 .abort() 方法，
  // 旧实现调用 signal.abort() 会抛 TypeError 且 fetch 不会被用户取消中止。
  const timeoutSignal = AbortSignal.timeout(timeout)
  const combined = typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal

  const fetchOpts: RequestInit = { signal: combined, credentials: 'include' }
  if (referrer) {
    fetchOpts.referrer = referrer
    fetchOpts.referrerPolicy = 'unsafe-url'
  }
  const response = await fetch(url, fetchOpts)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`)
  }
  return response
}

async function fetchWithRetry<T = ArrayBuffer>(
  url: string,
  signal: AbortSignal,
  retries: number,
  timeout: number,
  referrer?: string,
  read: (response: Response) => Promise<T> = async (response) =>
    (await response.arrayBuffer()) as T
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const response = await fetchWithTimeout(url, signal, timeout, referrer)
      return await read(response)
    } catch (error: any) {
      if (error.name === 'AbortError') throw error
      if (attempt === retries) {
        // 网络级 TypeError 默认只有裸 "Failed to fetch"，附带地址便于定位
        const msg = error.message || String(error)
        throw new Error(msg.includes(url) ? msg : `${msg} [${url}]`)
      }
    }
  }
  throw new Error('下载重试次数已用尽')
}

async function fetchPageTitle(pageUrl: string, signal: AbortSignal): Promise<string> {
  if (!pageUrl || !pageUrl.startsWith('http')) return ''
  try {
    const resp = await fetch(pageUrl, { signal, headers: { 'Accept': 'text/html' } })
    if (!resp.ok) return ''
    const html = await resp.text()
    // 优先 og:title
    const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i)
    if (ogMatch?.[1]) {
      const decoded = decodeHtmlEntities(ogMatch[1]).trim()
      if (decoded && !/^\d+$/.test(decoded)) return decoded
    }
    // 退回 <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch?.[1]) {
      const decoded = decodeHtmlEntities(titleMatch[1]).trim()
      if (decoded && !/^\d+$/.test(decoded)) return decoded
    }
  } catch {
    // fetch 失败时静默忽略
  }
  return ''
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function concatArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return result.buffer
}
