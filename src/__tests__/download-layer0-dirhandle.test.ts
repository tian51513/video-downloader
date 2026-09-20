import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChromeMock } from './chrome-mock'

/**
 * Layer 0（目录句柄直写）测试
 *
 * 契约：配置了保存目录且权限 granted 时，常规视频由 SW fetch →
 * 直写配置目录完成（与 HLS 保存同路径），不经 chrome.downloads；
 * 句柄缺失 / 权限回退 / fetch 失败 / 另存为开关开启时，
 * 一律降级到 Layer 1（chrome.downloads）。
 */

// Layer 1 默认可用（返回下载 id）；用 downloadCalls 断言"是否被走到"
const { chrome, downloadCalls } = createChromeMock({})
vi.stubGlobal('chrome', chrome)

const dirState = vi.hoisted(() => ({ handle: null as any }))
vi.mock('../utils/directory-handle', () => ({
  getDirectoryHandle: vi.fn(async () => dirState.handle),
  DOWNLOAD_DIR: 'download-directory',
  saveDirectoryHandle: vi.fn(),
  removeDirectoryHandle: vi.fn(),
}))

const settingsState = vi.hoisted(() => ({ askSaveLocation: false }))
const storageState = vi.hoisted(() => ({ tasks: [] as any[] }))
vi.mock('../utils/storage', () => ({
  saveDownloads: vi.fn((tasks: any[]) => {
    storageState.tasks = JSON.parse(JSON.stringify(tasks))
    return Promise.resolve()
  }),
  getDownloads: vi.fn(() => Promise.resolve(storageState.tasks)),
  getSettings: vi.fn(() =>
    Promise.resolve({
      downloadSettings: { maxConcurrent: 3, askSaveLocation: settingsState.askSaveLocation },
    })
  ),
  initDefaultSettings: vi.fn(() => Promise.resolve()),
}))

vi.mock('../utils/offscreen-blob', () => ({
  fetchAndDownload: vi.fn(() => Promise.reject(new Error('offscreen fetch failed'))),
  ensureOffscreen: vi.fn(),
}))

vi.mock('../background/hls-downloader', () => ({
  downloadHls: vi.fn(),
}))

vi.mock('../utils/sanitize', () => ({
  sanitizeName: vi.fn((s: string) => s),
}))

const { createDownloadTask, getAllDownloadTasks } = await import('../background/download-manager')

function makeDirHandle(perm: string) {
  const written: Uint8Array[] = []
  const dirHandle: any = {
    name: 'temp',
    queryPermission: vi.fn(async () => perm),
    getFileHandle: vi.fn(async () => ({
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (chunk: Uint8Array) => { written.push(chunk) }),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
      })),
    })),
  }
  return { dirHandle, written }
}

function stubFetch(ok: boolean, chunks: Uint8Array[] = [new Uint8Array([1, 2, 3])]) {
  let i = 0
  const fetchMock = vi.fn(async () => ({
    ok,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      }),
    },
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length'
          ? String(chunks.reduce((a, c) => a + c.byteLength, 0))
          : null,
    },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// 每个用例独立 URL：第 1 个用例完成后 URL 会进入已下载清单
// （downloaded-registry，chrome.storage mock 跨用例共享），复用会被去重跳过
let seq = 0
function makeVideo(): import('../types').DetectedVideo {
  seq += 1
  return {
    id: `test_video_${seq}`,
    url: `https://example.com/video_${seq}.mp4`,
    title: 'Test Video',
    format: 'mp4',
    mimeType: 'video/mp4',
    source: 'network',
    pageUrl: 'https://example.com/page',
    domain: 'example.com',
    detectedAt: Date.now(),
  }
}

describe('Layer 0 目录句柄直写', () => {
  beforeEach(() => {
    dirState.handle = null
    settingsState.askSaveLocation = false
    storageState.tasks = []
    downloadCalls.length = 0 // 普通数组，clearAllMocks 清不掉，跨用例会残留
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.stubGlobal('chrome', chrome)
  })

  it('权限有效时直写配置目录，不经 chrome.downloads，任务完成', async () => {
    const { dirHandle, written } = makeDirHandle('granted')
    dirState.handle = dirHandle
    stubFetch(true)

    await createDownloadTask(makeVideo(), 'chrome')
    await new Promise((r) => setTimeout(r, 500))

    expect(downloadCalls.length).toBe(0)
    expect(dirHandle.getFileHandle).toHaveBeenCalledTimes(1)
    expect(written.length).toBeGreaterThan(0)
    const tasks = await getAllDownloadTasks()
    expect(tasks[0].status).toBe('completed')
  })

  it('权限回退（prompt）时降级 Layer 1', async () => {
    const { dirHandle, written } = makeDirHandle('prompt')
    dirState.handle = dirHandle
    stubFetch(true)

    await createDownloadTask(makeVideo(), 'chrome')
    await new Promise((r) => setTimeout(r, 500))

    expect(downloadCalls.length).toBeGreaterThanOrEqual(1)
    expect(dirHandle.getFileHandle).not.toHaveBeenCalled()
    expect(written.length).toBe(0)
  })

  it('未配置目录时降级 Layer 1', async () => {
    dirState.handle = null
    stubFetch(true)

    await createDownloadTask(makeVideo(), 'chrome')
    await new Promise((r) => setTimeout(r, 500))

    expect(downloadCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('另存为开关开启时跳过 Layer 0，走浏览器对话框', async () => {
    const { dirHandle } = makeDirHandle('granted')
    dirState.handle = dirHandle
    settingsState.askSaveLocation = true
    stubFetch(true)

    await createDownloadTask(makeVideo(), 'chrome')
    await new Promise((r) => setTimeout(r, 500))

    expect(dirHandle.queryPermission).not.toHaveBeenCalled()
    expect(downloadCalls.length).toBeGreaterThanOrEqual(1)
    expect(downloadCalls[0].saveAs).toBe(true)
  })

  it('fetch 失败（HTTP 错误）时降级 Layer 1', async () => {
    dirState.handle = makeDirHandle('granted').dirHandle
    stubFetch(false)

    await createDownloadTask(makeVideo(), 'chrome')
    await new Promise((r) => setTimeout(r, 500))

    expect(downloadCalls.length).toBeGreaterThanOrEqual(1)
  })
})
