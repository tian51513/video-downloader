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

// fetch 路由：按 URL 返回预置内容；failFirst 控制指定 URL 先抛几次 TypeError
// （模拟瞬时网络失败 "Failed to fetch"）
const files = vi.hoisted(() => ({ map: new Map<string, Uint8Array | string>() }))
const failFirst = vi.hoisted(() => ({ map: new Map<string, number>() }))
const fetchMock = vi.fn(async (input: any, _init?: any) => {
  const url = typeof input === 'string' ? input : input.url
  const fails = failFirst.map.get(url) || 0
  if (fails > 0) {
    failFirst.map.set(url, fails - 1)
    throw new TypeError('Failed to fetch')
  }
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

const { downloadHls, patchMp4Metadata } = await import('../background/hls-downloader')

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
      queryPermission: async () => 'granted',
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
  failFirst.map.clear()
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

  it('相对 URL：替换末段候选 404 → 追加候选命中（/video/<id>/ 形态站点）', async () => {
    // 复现 huangguo.video sbezh91s 失败单：srcdoc/blob iframe 中检测层无法解析
    // 相对地址（new URL 对此类基准抛异常），SW 兜底按"替换末段"解析出
    // /video/720p/...（不存在），真实基准是 /video/<id>/（追加语义）
    const pageUrl = 'https://huangguo.video/video/sbezh91s'
    const appendBase = `${pageUrl}/720p`
    files.map.set(`${appendBase}/index.m3u8?n=tok`, MEDIA_PLAYLIST('init.mp4'))
    files.map.set(`${appendBase}/init.mp4`, INIT)
    files.map.set(`${appendBase}/seg1.m4s`, seg(1))
    files.map.set(`${appendBase}/seg2.m4s`, seg(2))

    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const task = makeTask({
      url: '720p/index.m3u8?n=tok',
      pageUrl,
      title: '母子同欢 · 第3集',
    })
    const result = await downloadHls(task, new AbortController().signal, 3, vi.fn(), vi.fn())

    // 两个候选都尝试过，追加候选被真正请求
    const fetched = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
    expect(fetched).toContain('https://huangguo.video/video/720p/index.m3u8?n=tok')
    expect(fetched).toContain(`${appendBase}/index.m3u8?n=tok`)
    // 分片相对追加候选的 m3u8 地址解析
    expect(fetched).toContain(`${appendBase}/seg1.m4s`)
    expect(result.savedFileName).toBe('母子同欢 · 第3集.mp4')
    expect(dir.written[0].data).toEqual(concat(INIT, seg(1), seg(2)))
  })

  it('m3u8 获取瞬时网络失败 → 按重试次数重试后成功（此前 Step1 无重试直接失败）', async () => {
    setupBasicFmp4()
    failFirst.map.set(`${BASE}/media.m3u8`, 2) // retryCount=2 → 第 3 次成功

    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const result = await downloadHls(makeTask(), new AbortController().signal, 3, vi.fn(), vi.fn())

    expect(result.savedFileName).toBe('测试 HLS 视频.mp4')
    expect(dir.written[0].data).toEqual(concat(INIT, seg(1), seg(2)))
  })

  it('m3u8 全部候选获取失败 → 错误信息带阶段与候选地址（告别裸 Failed to fetch）', async () => {
    const pageUrl = 'https://huangguo.video/video/sbezh91s'
    const task = makeTask({ url: '720p/index.m3u8?n=tok', pageUrl })

    await expect(
      downloadHls(task, new AbortController().signal, 3, vi.fn(), vi.fn())
    ).rejects.toThrow(/m3u8 获取失败/)

    // 替换末段与追加两个候选都被尝试
    const fetched = fetchMock.mock.calls.map((c: any[]) => String(c[0]))
    expect(fetched).toContain('https://huangguo.video/video/720p/index.m3u8?n=tok')
    expect(fetched).toContain(`${pageUrl}/720p/index.m3u8?n=tok`)
  })

  it('网络级失败(TypeError) → 错误信息附带请求地址', async () => {
    failFirst.map.set(`${BASE}/media.m3u8`, 99) // 永远失败，重试用尽

    await expect(
      downloadHls(makeTask(), new AbortController().signal, 3, vi.fn(), vi.fn())
    ).rejects.toThrow(/media\.m3u8/)
  })

  it('init segment 元数据为垃圾值（0 日期/13 小时时长）→ 落盘前被修补为真实时长', async () => {
    // 复现"保存后显示 1904 年 + 13 小时"缺陷：CDN 的 init segment 里
    // mvhd/mehd 时长是垃圾值、创建时间为 0（Mac 纪元 1904-01-01）
    const GARBAGE_DURATION = 4212000000 // ≈ 13h @ timescale 90000
    files.map.set(`${BASE}/media.m3u8`, MEDIA_PLAYLIST('init-meta.mp4'))
    files.map.set(`${BASE}/init-meta.mp4`, metaInit(GARBAGE_DURATION))
    files.map.set(`${BASE}/seg1.m4s`, seg(1))
    files.map.set(`${BASE}/seg2.m4s`, seg(2))

    const dir = fakeDirHandle()
    dirState.handle = dir.handle

    const result = await downloadHls(makeTask(), new AbortController().signal, 3, vi.fn(), vi.fn())
    expect(result.savedFileName).toBeTruthy()

    // 写入数据中 mvhd/mehd/tkhd 时长 = 2×6.0s × timescale，创建时间非 0
    const data = dir.written[0].data
    expect(u32At(data, findBox(data, 'mvhd') + 16)).toBe(12 * 90000)
    expect(u32At(data, findBox(data, 'mehd') + 4)).toBe(12 * 90000)
    expect(u32At(data, findBox(data, 'tkhd') + 20)).toBe(12 * 90000)
    // mdhd 用轨道自身 timescale（44100）换算——夸克等播放器优先读它
    expect(u32At(data, findBox(data, 'mdhd') + 16)).toBe(12 * 44100)
    expect(u32At(data, findBox(data, 'mvhd') + 4)).toBeGreaterThan(0)
  })
})

// ===== MP4 元数据修补 =====

/** 构造带垃圾元数据的 init segment：ftyp + moov[mvhd + trak/tkhd + mdia/mdhd + mvex/mehd] */
function metaInit(duration: number, timescale = 90000, mediaTimescale = 44100): Uint8Array {
  const fullBox = (version: number, fields: number[]): Uint8Array => {
    const payload = new Uint8Array(4 + fields.length * 4)
    const dv = new DataView(payload.buffer)
    dv.setUint8(0, version)
    fields.forEach((f, i) => dv.setUint32(4 + i * 4, f))
    return payload
  }
  // mvhd v0: creation(0)@4 modification(0)@8 timescale@12 duration@16
  const mvhd = box('mvhd', fullBox(0, [0, 0, timescale, duration, 0, 0]))
  // tkhd v0: creation@4 modification@8 track_id@12 reserved@16 duration@20
  const tkhd = box('tkhd', fullBox(0, [0, 0, 1, 0, duration]))
  // mdhd v0: creation@4 modification@8 timescale@12 duration@16（轨道自有 timescale）
  const mdhd = box('mdhd', fullBox(0, [0, 0, mediaTimescale, duration]))
  // mehd v0: fragment_duration@4
  const mehd = box('mehd', fullBox(0, [duration]))
  return concat(
    box('ftyp'),
    box('moov', concat(mvhd, box('trak', concat(tkhd, box('mdia', mdhd))), box('mvex', mehd)))
  )
}

/** 在字节数组中定位 box 类型的内容偏移（'mvhd' 四字节标记 + 4 = 内容起点） */
function findBox(data: Uint8Array, type: string): number {
  const target = new TextEncoder().encode(type)
  outer: for (let i = 0; i + 4 <= data.length; i++) {
    for (let j = 0; j < 4; j++) {
      if (data[i + j] !== target[j]) continue outer
    }
    return i + 4
  }
  throw new Error('box not found: ' + type)
}

function u32At(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset)
}

describe('patchMp4Metadata（纯函数）', () => {
  it('垃圾时长/零日期 → 按 #EXTINF 总时长与当前时间改写 mvhd/mehd/tkhd/mdhd', () => {
    const buf = metaInit(4212000000).slice().buffer
    const patched = patchMp4Metadata(buf, 46.5)
    const u8 = new Uint8Array(patched)
    expect(u32At(u8, findBox(u8, 'mvhd') + 16)).toBe(Math.round(46.5 * 90000))
    expect(u32At(u8, findBox(u8, 'mehd') + 4)).toBe(Math.round(46.5 * 90000))
    expect(u32At(u8, findBox(u8, 'tkhd') + 20)).toBe(Math.round(46.5 * 90000))
    expect(u32At(u8, findBox(u8, 'mdhd') + 16)).toBe(Math.round(46.5 * 44100))
    // 创建时间 = 当前时间的 Mac 纪元表示（留 60s 余量）
    expect(u32At(u8, findBox(u8, 'mvhd') + 4)).toBeGreaterThan(
      Math.floor(Date.now() / 1000) + 2082844800 - 60
    )
  })

  it('无 moov/mvhd（如 mux.js 产物结构差异）→ 原样返回不抛错', () => {
    const original = concat(INIT, seg(1))
    const buf = original.slice().buffer
    const patched = new Uint8Array(patchMp4Metadata(buf, 12))
    expect(patched).toEqual(original)
  })

  it('总时长非正 → 不改写', () => {
    const original = metaInit(123)
    const buf = original.slice().buffer
    const patched = new Uint8Array(patchMp4Metadata(buf, 0))
    expect(patched).toEqual(original)
  })
})
