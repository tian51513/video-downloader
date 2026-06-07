/**
 * HLS 下载编排器
 * 解析 m3u8 → 并行下载分片 → 解密 → 封装为 MP4 → 保存
 */

import type { DownloadTask, DownloadStatus } from '../types'
import { getFullSettings } from './settings'
import { sanitizeName } from '../utils/sanitize'
import { getDirectoryHandle, DOWNLOAD_DIR } from '../utils/directory-handle'
import {
  parseM3u8,
  selectVariant,
  type HlsMediaPlaylist,
} from './hls-parser'
// @ts-expect-error mux.js 没有内置类型声明
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

  const m3u8Response = await fetchWithTimeout(task.video.url, signal, timeout, referrer)
  const m3u8Text = await m3u8Response.text()

  let playlist = parseM3u8(m3u8Text, task.video.url)
  console.log(`[HLS] m3u8 解析完成, 类型: ${playlist.type}`)

  // 如果是主播放列表，跟随最高码率变体
  if (playlist.type === 'master') {
    const variant = selectVariant(playlist)
    console.log(`[HLS] 主播放列表，选择变体: ${variant.resolution || ''} ${variant.bandwidth}bps → ${variant.url}`)
    const variantResponse = await fetchWithTimeout(variant.url, signal, timeout, referrer)
    const variantText = await variantResponse.text()
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
    await decryptSegments(segmentBuffers, segments, mediaPlaylist.encryption.keyUrl, signal, referrer)
    console.log('[HLS] 解密完成')
  }

  // Step 4: 封装为有效 MP4
  onStatusChange('merging')
  console.log('[HLS] 开始封装 MP4...')
  const mp4Data = await remuxToMp4(segmentBuffers, mediaPlaylist, signal, referrer)
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
    if (dirHandle) {
      console.log('[HLS] 使用目录句柄直接写入')
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(mp4Data)
      await writable.close()
      console.log(`[HLS] 文件保存成功: ${filename}`)
      return { savedFileName: filename }
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
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
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

// ===== IndexedDB 工具函数 =====

function writeToSaveDB(key: string, data: ArrayBuffer): Promise<void> {
  return ensureSaveDB().then(db => {
    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(SAVE_STORE_NAME, 'readwrite')
        tx.objectStore(SAVE_STORE_NAME).put(data, key)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
      } catch (e) {
        db.close()
        reject(e)
      }
    })
  })
}

function ensureSaveDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SAVE_DB_NAME)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SAVE_STORE_NAME)) {
        db.createObjectStore(SAVE_STORE_NAME)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SAVE_STORE_NAME)) {
        db.close()
        const ver = db.version + 1
        const req2 = indexedDB.open(SAVE_DB_NAME, ver)
        req2.onupgradeneeded = () => {
          req2.result.createObjectStore(SAVE_STORE_NAME)
        }
        req2.onsuccess = () => resolve(req2.result)
        req2.onerror = () => reject(req2.error)
        return
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
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
  referrer?: string
): Promise<void> {
  const fetchOpts: RequestInit = { signal }
  if (referrer) {
    fetchOpts.referrer = referrer
    fetchOpts.referrerPolicy = 'unsafe-url'
  }
  const keyResponse = await fetch(keyUrl, fetchOpts)
  const keyData = await keyResponse.arrayBuffer()
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, ['decrypt'])

  for (let i = 0; i < buffers.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

    const segKey = segments[i].key
    if (!segKey) continue

    const iv = segKey.iv || new Uint8Array(16)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, buffers[i])
    buffers[i] = decrypted
  }
}

// ===== 工具函数 =====

async function fetchWithTimeout(
  url: string,
  signal: AbortSignal,
  timeout: number,
  referrer?: string
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeout)
  const combinedAbort = () => {
    if (signal.aborted) timeoutSignal.abort()
  }
  signal.addEventListener('abort', combinedAbort, { once: true })

  try {
    const fetchOpts: RequestInit = { signal: timeoutSignal, credentials: 'include' }
    if (referrer) {
      fetchOpts.referrer = referrer
      fetchOpts.referrerPolicy = 'unsafe-url'
    }
    const response = await fetch(url, fetchOpts)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`)
    }
    return response
  } finally {
    signal.removeEventListener('abort', combinedAbort)
  }
}

async function fetchWithRetry(
  url: string,
  signal: AbortSignal,
  retries: number,
  timeout: number,
  referrer?: string
): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const response = await fetchWithTimeout(url, signal, timeout, referrer)
      return await response.arrayBuffer()
    } catch (error: any) {
      if (error.name === 'AbortError') throw error
      if (attempt === retries) throw error
    }
  }
  throw new Error('下载重试次数已用尽')
}

function looksLikeFallback(title: string): boolean {
  if (!title) return true
  // 自动生成的回退名模式
  if (/^(hls|video)_\d+$/.test(title)) return true
  // 纯数字 ID
  if (/^\d{6,}$/.test(title)) return true
  // hash 类 ID (如 simpleId 产物)
  if (/^[a-z0-9]+_\d+$/.test(title)) return true
  // domain_timestamp 模式
  if (/^.+_\d{14}$/.test(title)) return true
  // UUID 格式 (如 xhamster.com 页面初始标题)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title.trim())) return true
  return false
}

/**
 * 清理站点标题后缀（去除 " | site"、" – tags | site" 等）
 */
function cleanSiteTitleSuffix(title: string): string {
  // "标题 – tags/categories | site" 模式 (xhamster 等)
  // 必须同时有 " | " 分隔符才视为站点标题模式
  const pipeIdx = title.lastIndexOf(' | ')
  if (pipeIdx > 0) {
    const before = title.substring(0, pipeIdx).trim()
    const dashIdx = before.lastIndexOf(' – ')
    if (dashIdx > 0) {
      const candidate = before.substring(0, dashIdx).trim()
      if (candidate.length > 3) return candidate
    }
    if (before.length > 3) return before
  }
  // 没有 " | " 模式时不动标题（og:title 通常已经是干净的）
  return title
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

function extractNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter((s) => s && s !== '.')
    if (segments.length > 0) {
      let last = segments[segments.length - 1].split('?')[0].split('#')[0]
      last = last.replace(/\.\w+$/, '')
      try { last = decodeURIComponent(last) } catch { /* ignore */ }
      last = last.replace(/[-_]+/g, ' ')
      if (last && last.length > 2 && !/^\d+$/.test(last)) return last
    }
    return parsed.hostname.replace('www.', '')
  } catch {
    return ''
  }
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
