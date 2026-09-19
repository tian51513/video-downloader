import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChromeMock } from './chrome-mock'

/**
 * 测试：background 消息路由（background/index.ts 的 handleMessage）
 *
 * 此前 handleMessage 是模块私有函数，200 行 switch 不可测——要测路由必须
 * 加载整个 SW 文件（导入即注册 8 个 chrome 监听器）。现导出为纯函数，
 * 依赖（download-manager / storage）全部 mock，直接验证路由契约。
 */

const chromeMock = createChromeMock()
vi.stubGlobal('chrome', chromeMock.chrome)

const dm = vi.hoisted(() => ({
  createDownloadTask: vi.fn(),
  processQueue: vi.fn(() => Promise.resolve()),
  pauseDownload: vi.fn(() => Promise.resolve()),
  cancelDownload: vi.fn(() => Promise.resolve()),
  retryDownload: vi.fn(() => Promise.resolve()),
  getAllDownloadTasks: vi.fn(() => Promise.resolve([{ id: 'dl_1', status: 'downloading' }])),
  updateTaskProgressFromPage: vi.fn(() => Promise.resolve()),
  completeDownloadTask: vi.fn(() => Promise.resolve()),
  failDownloadTask: vi.fn(() => Promise.resolve()),
  clearCompletedDownloads: vi.fn(() => Promise.resolve()),
  clearCompletedFullDownloads: vi.fn(() => Promise.resolve()),
  clearFailedDownloads: vi.fn(() => Promise.resolve()),
  clearOrphanedDownloads: vi.fn(() => Promise.resolve()),
  clearPageDownloads: vi.fn(() => Promise.resolve()),
  removeDownloadTask: vi.fn(() => Promise.resolve()),
}))

vi.mock('../background/download-manager', () => dm)

vi.mock('../utils/storage', () => ({
  initDefaultSettings: vi.fn(() => Promise.resolve()),
  saveVideos: vi.fn(() => Promise.resolve()),
  getVideos: vi.fn(() => Promise.resolve([])),
  clearVideos: vi.fn(() => Promise.resolve()),
  getAllVideos: vi.fn(() => Promise.resolve([])),
  clearAllVideos: vi.fn(() => Promise.resolve()),
  clearOrphanedVideos: vi.fn(() => Promise.resolve()),
  removeVideosByUrls: vi.fn(() => Promise.resolve()),
  removeVideosByDownloads: vi.fn(() => Promise.resolve()),
  downloadMatcher: vi.fn(() => () => false),
  getSettings: vi.fn(() => Promise.resolve({ downloadSettings: {} })),
}))

const { handleMessage } = await import('../background/index')
const storageMocks = await import('../utils/storage')

// import 时注册的 onDeterminingFilename 安全网监听器
// （beforeEach 的 clearAllMocks 会清调用记录，必须在清空前捕获）
const determiningListener = (chromeMock.chrome.downloads.onDeterminingFilename.addListener as any)
  .mock.calls[0]?.[0] as Function | undefined

const send = (type: string, payload?: any) =>
  handleMessage({ type: type as any, payload }, {} as any)

describe('消息路由：页面/辅助页 → 任务状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PAGE_DOWNLOAD_DONE → completeDownloadTask（成功不再被误标为取消）', async () => {
    await send('PAGE_DOWNLOAD_DONE', { taskId: 'dl_1', chromeDownloadId: 42 })

    expect(dm.completeDownloadTask).toHaveBeenCalledWith('dl_1', 42)
    expect(dm.cancelDownload).not.toHaveBeenCalled()
  })

  it('PAGE_FETCH_ERROR → failDownloadTask（携带诊断错误）', async () => {
    await send('PAGE_FETCH_ERROR', { taskId: 'dl_1', error: 'TypeError: Failed to fetch' })

    expect(dm.failDownloadTask).toHaveBeenCalledWith('dl_1', 'TypeError: Failed to fetch')
  })

  it('SAVE_HELPER_DONE 成功 → completeDownloadTask；失败 → failDownloadTask', async () => {
    await send('SAVE_HELPER_DONE', { taskId: 'dl_1', success: true, chromeDownloadId: 7 })
    expect(dm.completeDownloadTask).toHaveBeenCalledWith('dl_1', 7)

    await send('SAVE_HELPER_DONE', { taskId: 'dl_2', success: false, error: '写入失败' })
    expect(dm.failDownloadTask).toHaveBeenCalledWith('dl_2', '写入失败')
  })

  it('SAVE_HELPER_PROGRESS 上报 {loaded,total} → 换算为进度字段', async () => {
    await send('SAVE_HELPER_PROGRESS', { taskId: 'dl_1', loaded: 25, total: 100, speed: 0 })

    expect(dm.updateTaskProgressFromPage).toHaveBeenCalledWith('dl_1', 25, 0, 25, 100)
  })

  it('SAVE_VIA_CHROME_DOWNLOADS → SW 代下载并注册 onDeterminingFilename 文件名安全网', async () => {
    const res = await send('SAVE_VIA_CHROME_DOWNLOADS', {
      blobUrl: 'blob:chrome-extension://fake-id/uuid1',
      filename: '正确文件名.mp4',
      taskId: 'dl_1',
    })

    // SW 执行下载，携带指定文件名
    expect(res).toEqual({ success: true, downloadId: 101 })
    expect(chromeMock.chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'blob:chrome-extension://fake-id/uuid1',
        filename: '正确文件名.mp4',
      })
    )

    // 安全网生效：即使下载被其它因素改名，onDeterminingFilename 强制回指定名
    expect(determiningListener).toBeInstanceOf(Function)
    const suggest = vi.fn()
    determiningListener!({ id: 101 }, suggest)
    expect(suggest).toHaveBeenCalledWith({ filename: '正确文件名.mp4', conflictAction: 'uniquify' })
  })

  it('SAVE_VIA_CHROME_DOWNLOADS 下载失败 → 返回 success:false 与错误信息', async () => {
    ;(chromeMock.chrome.downloads.download as any).mockRejectedValueOnce(
      new Error('INVALID_URL')
    )

    const res = await send('SAVE_VIA_CHROME_DOWNLOADS', {
      blobUrl: 'blob:bad',
      filename: 'x.mp4',
    })

    expect(res).toEqual({ success: false, error: 'INVALID_URL' })
  })

  it('CLEAR_COMPLETED_DOWNLOADS → 清记录并把已完成视频组级移出检测列表', async () => {
    // 快照先于清记录：返回一条已完成任务供移除
    dm.getAllDownloadTasks.mockResolvedValueOnce([
      {
        id: 'dl_9',
        status: 'completed',
        video: { url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '视频A' },
      },
    ] as any)

    await send('CLEAR_COMPLETED_DOWNLOADS')

    expect(dm.clearCompletedDownloads).toHaveBeenCalled()
    expect(storageMocks.removeVideosByDownloads).toHaveBeenCalledWith([
      { url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '视频A' },
    ])
  })

  it('VIDEO_DETECTED 同页两次上报不同视频 → 并集合并不互相抹除（srcdoc iframe 场景）', async () => {
    const { saveVideos } = await import('../utils/storage')

    await send('VIDEO_DETECTED', {
      pageUrl: 'about:srcdoc',
      videos: [{ id: 'v1', url: 'https://cdn.test/1.m3u8', pageUrl: 'about:srcdoc', format: 'hls' }],
    })
    await send('VIDEO_DETECTED', {
      pageUrl: 'about:srcdoc',
      videos: [{ id: 'v2', url: 'https://cdn.test/2.m3u8', pageUrl: 'about:srcdoc', format: 'hls' }],
    })

    // 第二次保存的列表应同时包含 v1 与 v2（覆写语义会丢 v1）
    const saved = (saveVideos as any).mock.calls.at(-1)
    const ids = saved[1].map((v: any) => v.id).sort()
    expect(ids).toEqual(['v1', 'v2'])
  })

  it('SUPPRESS_FRAGMENTS → 按 URL 显式删除并广播剩余列表', async () => {
    // 预置两条，删除其中分片一条
    await send('VIDEO_DETECTED', {
      pageUrl: 'https://p.test/1',
      videos: [
        { id: 'variant', url: 'https://cdn.test/hd/index.m3u8', pageUrl: 'https://p.test/1', format: 'hls' },
        { id: 'seg1', url: 'https://cdn.test/hd/seg_00000.ts', pageUrl: 'https://p.test/1', format: 'ts', size: 524288 },
      ],
    })

    await send('SUPPRESS_FRAGMENTS', {
      pageUrl: 'https://p.test/1',
      urls: ['https://cdn.test/hd/seg_00000.ts'],
    })

    expect(storageMocks.removeVideosByUrls).toHaveBeenCalledWith(['https://cdn.test/hd/seg_00000.ts'])
    // 广播的剩余列表只剩变体（分片已从内存缓存移除）
    const broadcasts = (chromeMock.chrome.runtime.sendMessage as any).mock.calls
      .filter((c: any[]) => c[0]?.type === 'VIDEO_DETECTED')
    const last = broadcasts.at(-1)[0].payload
    expect(last.pageUrl).toBe('https://p.test/1')
    expect(last.videos.map((v: any) => v.id)).toEqual(['variant'])
  })

  it('CANCEL_DOWNLOAD / PAUSE_DOWNLOAD / RETRY_DOWNLOAD / REMOVE_DOWNLOAD 各就各位', async () => {
    await send('CANCEL_DOWNLOAD', { taskId: 'dl_1' })
    await send('PAUSE_DOWNLOAD', { taskId: 'dl_1' })
    await send('RETRY_DOWNLOAD', { taskId: 'dl_1' })
    await send('REMOVE_DOWNLOAD', { taskId: 'dl_1' })

    expect(dm.cancelDownload).toHaveBeenCalledWith('dl_1')
    expect(dm.pauseDownload).toHaveBeenCalledWith('dl_1')
    expect(dm.retryDownload).toHaveBeenCalledWith('dl_1')
    expect(dm.removeDownloadTask).toHaveBeenCalledWith('dl_1')
  })

  it('GET_DOWNLOADS 返回任务列表', async () => {
    const res = await send('GET_DOWNLOADS')

    expect(res).toEqual({ tasks: [{ id: 'dl_1', status: 'downloading' }] })
  })
})
