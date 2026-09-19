/**
 * 下载管理 facade（编排层）
 *
 * 职责：任务创建（去重 + 页面标题刷新）、队列调度、下载方式分发
 * （外部下载器 / HLS / Chrome 多层级降级）。任务状态机在 ./downloads/task-store，
 * 执行器在 ./downloads/{chrome-downloader,external-downloaders}，
 * 命名与 DNR 规则在 ./downloads/{naming,dnr-rules}。
 *
 * 本文件同时 re-export 稳定接口（background/index.ts 与测试依赖这些名字）。
 */

import type { DetectedVideo, DownloadTask, DownloaderType } from '../types'
import { getSettings as getFullSettings } from '../utils/storage'
import {
  findNonFailedByUrl,
  getQueue,
  getActiveHlsCount,
  setActiveEntry,
  deleteActiveEntry,
  pushTask,
  persistTasks,
  broadcastDownloadUpdate,
  updateTaskStatus,
  onQueueDrain,
} from './downloads/task-store'
import { downloadWithAria2, downloadWithIDM } from './downloads/external-downloaders'
import { startDirectDownload, startHlsDownload } from './downloads/chrome-downloader'

// 兼容 re-export：稳定接口面（background/index.ts 与全部测试经本模块导入）
export {
  retryDownload,
  pauseDownload,
  cancelDownload,
  updateTaskChromeDownloadId,
  clearCompletedDownloads,
  clearCompletedFullDownloads,
  clearFailedDownloads,
  clearOrphanedDownloads,
  clearPageDownloads,
  removeDownloadTask,
  getAllDownloadTasks,
  completeDownloadTask,
  updateTaskProgressFromPage,
  failDownloadTask,
} from './downloads/task-store'
export { setupDownloadRules } from './downloads/dnr-rules'
export { buildDownloadFileName } from './downloads/naming'

// ===== 任务创建 =====

export async function createDownloadTask(
  video: DetectedVideo,
  downloader: DownloaderType
): Promise<DownloadTask> {
  // URL 级去重（失败任务除外——允许重试重建；状态机里没有 'cancelled'，取消即 failed）
  const existing = findNonFailedByUrl(video.url)
  if (existing) return existing

  const settings = await getFullSettings()

  // 从页面获取最新标题
  const title = await refreshTitleFromPage(video)

  const task: DownloadTask = {
    id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    video: { ...video, title: title || video.title },
    status: 'pending',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: video.size || 0,
    downloader,
  }

  pushTask(task)
  await persistTasks()
  broadcastDownloadUpdate(task)
  processQueue()

  return task
}

// ===== 从页面获取最新标题 =====

async function refreshTitleFromPage(video: DetectedVideo): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) return video.title

    // 只对同页面视频刷新标题
    const videoPageUrl = video.pageUrl || ''
    if (tab.url !== videoPageUrl) return video.title

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const title = document.title?.trim() || ''
        const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || ''
        const h1 = document.querySelector('h1')?.textContent?.trim() || ''
        return title || og || h1 || ''
      },
    })

    const pageName = results?.[0]?.result
    if (pageName && pageName.length > 0 && pageName.length < 200) return pageName
  } catch { /* ignore */ }
  return video.title
}

// ===== 队列调度 =====

export async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  try {
    while (true) {
      const settings = await getFullSettings()
      const { maxConcurrent } = settings.downloadSettings

      // HLS 下载占槽位（SW 实际执行下载），chrome.downloads 不占（浏览器自己下载）
      const hlsActiveCount = getActiveHlsCount()

      // 优先处理非 HLS 任务（fire-and-forget，不占槽位），再处理 HLS 任务
      let next = getQueue().find((t) => t.status === 'pending' && t.video.format !== 'hls')
      if (!next && hlsActiveCount < maxConcurrent) {
        next = getQueue().find((t) => t.status === 'pending')
      }
      if (!next) break

      const isHls = next.video.format === 'hls'
      updateTaskStatus(next.id, 'downloading')

      // 统一 fire-and-forget：HLS 占并发槽（见上方 hlsActiveCount 判定），
      // chrome.downloads / aria2 / idm 由浏览器或外部程序执行，不阻塞队列
      setActiveEntry(next.id, { isHls })
      downloadWithChrome(next, settings).catch((error: any) => {
        deleteActiveEntry(next.id)
        updateTaskStatus(next.id, 'failed', error.message)
      })
    }
  } finally {
    isProcessing = false
  }
}

let isProcessing = false

// 下载执行方（monitor/external/HLS）结算后请求再驱动队列（依赖反转，避免循环 import）
onQueueDrain(() => {
  void processQueue()
})

// ===== 下载方式分发 =====

async function downloadWithChrome(task: DownloadTask, settings: any): Promise<void> {
  // 外部下载器分发（aria2/motrix 走 JSON-RPC，idm 走协议跳转；
  // chrome 内置下载的 HLS/多层级降级分支见下）
  if (task.downloader === 'aria2' || task.downloader === 'motrix') {
    return downloadWithAria2(task, settings)
  }
  if (task.downloader === 'idm') {
    return downloadWithIDM(task)
  }

  // HLS 走专用下载器
  if (task.video.format === 'hls') {
    return startHlsDownload(task, settings.downloadSettings.maxConcurrent || 3)
  }

  return startDirectDownload(task, settings)
}
