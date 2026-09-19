import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChromeMock } from './chrome-mock'

/**
 * 测试：background 消息路由（background/index.ts 的 handleMessage）
 *
 * 此前 handleMessage 是模块私有函数，200 行 switch 不可测——要测路由必须
 * 加载整个 SW 文件（导入即注册 8 个 chrome 监听器）。现导出为纯函数，
 * 依赖（download-manager / storage）全部 mock，直接验证路由契约。
 */

vi.stubGlobal('chrome', createChromeMock().chrome)

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
  getSettings: vi.fn(() => Promise.resolve({ downloadSettings: {} })),
}))

const { handleMessage } = await import('../background/index')

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
