import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import type { DetectedVideo, DownloadTask } from '../types'
import { createChromeMock } from './chrome-mock'
import { idbGet } from '../utils/idb'

/**
 * 测试：HLS 下载编排器（background/hls-downloader.ts 的 downloadHls 全流程）
 *
 * 此前 641 行模块的唯一入口把 fetch/mux/IndexedDB/目录句柄全串联、无注入点
 * （零测试）。download-manager 拆分后经 seam 可测：fetch 走 URL 路由 mock、
 * 目录句柄可切换（fake handle 捕获写入 / null 触发降级）、IndexedDB 用
 * fake-indexeddb。走 fMP4 路径避开 mux.js 转封装（那属于库的行为）。
 */

const { chrome, tabsCreated } = createChromeMock()
vi.stubGlobal('chrome', chrome)

// 目录句柄可切换：null → 走 IndexedDB + save-helper 降级
const dirState = vi.hoisted(() => ({ handle: null as any }))
vi.mock('../utils/directory-handle', () => ({
  getDirectoryHandle: vi.fn(async () => dirState.handle),
  DOWNLOAD_DIR: 'download-directory',
}))

vi.mock('../utils/storage', () => ({
  getSettings: vi.fn(() =>
    Promise.resolve({
      downloadSettings: { maxConcurrent: 3, retryCount: 2, retryDelay: 0, timeout: 5000, askSaveLocation: false },
    })
  ),
  saveDownloads: vi.fn(() => Promise.resolve()),
  getDownloads: vi.fn(() => Promise.resolve([])),
}))

// fetch 路由：按 URL 返回预置内容
const files = vi.hoisted(() => ({ map: new Map<string, Uint8Array | string>() }))
const fetchMock = vi.fn(async (input: any, _init?: any) => {
  const url = typeof input === 'string' ? input : input.url
  const body = files.map.get(url)
  if (body === undefined) {
    return {
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => '',
      arrayBuffer: async () => {
        throw new Error('404: ' + url)
      },
    }
  }
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(bytes.byteLength) }),
    text: async () => (typeof body === 'string' ? body : new TextDecoder().decode(bytes)),
    arrayBuffer: async () => bytes.slice().buffer,
  }
})
vi.stubGlobal('fetch', fetchMock)

const { downloadHls } = await import('../background/hls-downloader')

// ===== 构造 fMP4 结构 =====

function box(type: string, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const buf = new Uint8Array(8 + payload.length)
  new DataView(buf.buffer).setUint32(0, buf.byteLength)
  buf.set(new TextEncoder().encode(type), 4)
  buf.set(payload, 8)
  return buf
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) {
    out.set(a, off)
    off += a.length
  }
  return out
}

/** 媒体分片：moof + mdat，首字节非 0x47（避免被判为 TS），可按 id 区分 */
function seg(id: number): Uint8Array {
  return concat(box('moof', new Uint8Array([id])), box('mdat', new Uint8Array([id, 0xaa])))
}

const INIT = concat(box('ftyp'), box('moov'))

/** segPrefix：分片相对变体 m3u8 自身 URL 解析，不同变体需各自前缀避免撞车 */
const MEDIA_PLAYLIST = (initUri: string, extra = '', segPrefix = '') => `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="${initUri}"
${extra}#EXTINF:6.0,
${segPrefix}seg1.m4s
#EXTINF:6.0,
${segPrefix}seg2.m4s
#EXT-X-ENDLIST
`

const BASE = 'https://cdn.test/video'

function makeTask(overrides: Partial<DetectedVideo> = {}): DownloadTask {
  return {
    id: 'dl_hls_test',
    video: {
      id: 'v_hls',
      url: `${BASE}/media.m3u8`,
      title: '测试 HLS 视频',
      format: 'hls',
      mimeType: 'application/vnd.apple.mpegurl',
      source: 'network',
      pageUrl: 'https://page.test/watch/1',
      domain: 'page.test',
      detectedAt: 1700000000000,
      ...overrides,
    },
    status: 'downloading',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloader: 'chrome',
  }
}

/** 捕获写入的假目录句柄 */
function fakeDirHandle() {
  const written: { name: string; data: Uint8Array }[] = []
  return {
    written,
    handle: {
      name: 'Downloads',
      getFileHandle: async (name: string) => ({
        createWritable: async () => {
          let sink: Uint8Array | null = null
          return {
            write: async (data: ArrayBuffer) => {
              sink = new Uint8Array(data)
            },
            close: async () => {
              written.push({ name, data: sink! })
            },
          }
        },
      }),
    },
  }
}

function setupBasicFmp4() {
  files.map.set(`${BASE}/media.m3u8`, MEDIA_PLAYLIST('init.mp4'))
  files.map.set(`${BASE}/init.mp4`, INIT)
  files.map.set(`${BASE}/seg1.m4s`, seg(1))
  files.map.set(`${BASE}/seg2.m4s`, seg(2))
}

beforeEach(() => {
  files.map.clear()
  tabsCreated.length = 0
  dirState.handle = null
  vi.clearAllMocks()
})

describe('downloadHls 编排：fMP4 直拼', () => {
  it('媒体播放列表 → 下载 init+分片 → 拼接 → 目录句柄写入，进度到 100', async () => {
    setupBasicFmp4()
    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const onProgress = vi.fn()
    const onStatusChange = vi.fn()
    const result = await downloadHls(makeTask(), new AbortController().signal, 3, onProgress, onStatusChange)

    // 文件名来自任务标题
    expect(result.savedFileName).toBe('测试 HLS 视频.mp4')

    // 写入内容 = init + seg1 + seg2
    expect(dir.written).toHaveLength(1)
    expect(dir.written[0].name).toBe('测试 HLS 视频.mp4')
    expect(dir.written[0].data).toEqual(concat(INIT, seg(1), seg(2)))

    // 进度收敛到 100%，字节数为分片总和
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1]
    expect(last[0]).toBe(100)
    expect(last[2]).toBe(seg(1).length + seg(2).length)

    // 无失败状态
    expect(onStatusChange).not.toHaveBeenCalledWith('failed', expect.anything())
  })

  it('master 播放列表 → 选择最高带宽变体', async () => {
    files.map.set(`${BASE}/master.m3u8`, `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
lo.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
hi.m3u8
`)
    files.map.set(`${BASE}/lo.m3u8`, MEDIA_PLAYLIST('lo/init.mp4', '', 'lo/'))
    files.map.set(`${BASE}/lo/init.mp4`, INIT)
    files.map.set(`${BASE}/lo/seg1.m4s`, seg(0x10))
    files.map.set(`${BASE}/lo/seg2.m4s`, seg(0x11))
    files.map.set(`${BASE}/hi.m3u8`, MEDIA_PLAYLIST('hi/init.mp4', '', 'hi/'))
    files.map.set(`${BASE}/hi/init.mp4`, INIT)
    files.map.set(`${BASE}/hi/seg1.m4s`, seg(0x20))
    files.map.set(`${BASE}/hi/seg2.m4s`, seg(0x21))

    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const result = await downloadHls(
      makeTask({ url: `${BASE}/master.m3u8` }),
      new AbortController().signal,
      3,
      vi.fn(),
      vi.fn()
    )

    expect(result.savedFileName).toBeTruthy()
    const fetched = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
    expect(fetched).toContain(`${BASE}/hi/seg1.m4s`)
    expect(fetched).not.toContain(`${BASE}/lo/seg1.m4s`)
    expect(dir.written[0].data).toEqual(concat(INIT, seg(0x20), seg(0x21)))
  })

  it('AES-128 加密（无显式 IV → RFC 序号 IV）→ 解密后拼接明文', async () => {
    setupBasicFmp4()
    // 用密钥+序号 IV 加密两个分片
    const keyBytes = new Uint8Array(16).fill(7)
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'])
    const seqIv = (i: number) => {
      const iv = new Uint8Array(16)
      new DataView(iv.buffer).setUint32(12, i, false)
      return iv
    }
    const enc = async (i: number) =>
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-CBC', iv: seqIv(i) as BufferSource },
          cryptoKey,
          seg(i + 1) as BufferSource
        )
      )

    files.map.set(`${BASE}/media.m3u8`, MEDIA_PLAYLIST('init.mp4', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n'))
    files.map.set(`${BASE}/key.bin`, keyBytes)
    files.map.set(`${BASE}/seg1.m4s`, await enc(0))
    files.map.set(`${BASE}/seg2.m4s`, await enc(1))

    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const onStatusChange = vi.fn()
    const result = await downloadHls(makeTask(), new AbortController().signal, 3, vi.fn(), onStatusChange)

    // 解密后写入的是明文 init + seg1 + seg2
    expect(dir.written[0].data).toEqual(concat(INIT, seg(1), seg(2)))
    // 解密/封装阶段上报 merging 状态
    expect(onStatusChange).toHaveBeenCalledWith('merging')
    expect(result.savedFileName).toBe('测试 HLS 视频.mp4')
  })

  it('无目录句柄 → 降级 IndexedDB + 打开 save-helper 页面（URL 携带 key/文件名/任务 id）', async () => {
    setupBasicFmp4()
    dirState.handle = null

    const task = makeTask()
    const result = await downloadHls(task, new AbortController().signal, 3, vi.fn(), vi.fn())

    expect(result.savedFileName).toBeTruthy()
    expect(tabsCreated).toHaveLength(1)

    const url = String(tabsCreated[0].url)
    expect(url).toContain('save-helper.html?k=')
    expect(url).toContain(`n=${encodeURIComponent('测试 HLS 视频.mp4')}`)
    expect(url).toContain('s=0')
    expect(url).toContain(`t=${encodeURIComponent(task.id)}`)

    // 数据已按 URL 中的 key 写入 IndexedDB（save-helper 将按 key 取回）
    const key = new URL(url).searchParams.get('k')!
    const saved = await idbGet<ArrayBuffer>('vd-pending-saves', 'pending-saves', key)
    expect(new Uint8Array(saved!)).toEqual(concat(INIT, seg(1), seg(2)))
  })

  it('相对 URL（页面 fetch 的原始参数）→ 相对 pageUrl 解析后下载成功', async () => {
    // 复现 huangguo.video 缺陷：检测层上报了 '480p/index.m3u8?n=...' 相对地址
    const resolved = 'https://huangguo.video/video/480p/index.m3u8?n=abc123'
    files.map.set(resolved, MEDIA_PLAYLIST('init.mp4'))
    files.map.set('https://huangguo.video/video/480p/init.mp4', INIT)
    files.map.set('https://huangguo.video/video/480p/seg1.m4s', seg(1))
    files.map.set('https://huangguo.video/video/480p/seg2.m4s', seg(2))

    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const task = makeTask({
      url: '480p/index.m3u8?n=abc123',
      pageUrl: 'https://huangguo.video/video/foqxppym',
      title: '母女日常 · 第1集',
    })
    const result = await downloadHls(task, new AbortController().signal, 3, vi.fn(), vi.fn())

    // 解析后的绝对地址被真正请求
    const fetched = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
    expect(fetched).toContain(resolved)
    // 相对 URL 不能原样进入 fetch
    expect(fetched).not.toContain('480p/index.m3u8?n=abc123')
    expect(dir.written[0].data).toEqual(concat(INIT, seg(1), seg(2)))
  })
})
