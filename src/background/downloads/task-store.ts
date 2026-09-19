/**
 * 下载任务状态机（叶子模块：仅依赖 types 与 storage）
 *
 * 拥有队列与活动执行句柄两个模块级状态，是任务状态迁移的唯一入口。
 * 完成回调通过 requestQueueDrain 观察者反转给调度器，避免 store→调度器
 * 的循环依赖。
 */

import type { DetectedVideo, DownloadTask } from '../../types'
import { saveDownloads, getDownloads } from '../../utils/storage'

export interface ActiveDownloadEntry {
  abortController?: AbortController
  chromeDownloadId?: number
  filename?: string
  isHls?: boolean
}

let downloadQueue: DownloadTask[] = []
const activeDownloads = new Map<string, ActiveDownloadEntry>()

// ===== 队列读取 =====

export function getQueue(): DownloadTask[] {
  return downloadQueue
}

export function getTask(taskId: string): DownloadTask | undefined {
  return downloadQueue.find((t) => t.id === taskId)
}

/** URL 级去重谓词（失败任务除外——允许重试重建） */
export function findNonFailedByUrl(url: string): DownloadTask | undefined {
  return downloadQueue.find((t) => t.video.url === url && t.status !== 'failed')
}

export async function getAllDownloadTasks(): Promise<DownloadTask[]> {
  downloadQueue = await getDownloads()
  return downloadQueue
}

// ===== 队列写入 =====

export function pushTask(task: DownloadTask): void {
  downloadQueue.push(task)
}

export async function persistTasks(): Promise<void> {
  await saveDownloads(downloadQueue)
}

export function broadcastDownloadUpdate(task: DownloadTask): void {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    payload: task,
  }).catch(() => {})
}

// ===== 活动执行句柄 =====

export function getActiveEntry(taskId: string): ActiveDownloadEntry | undefined {
  return activeDownloads.get(taskId)
}

export function setActiveEntry(taskId: string, entry: ActiveDownloadEntry): void {
  activeDownloads.set(taskId, entry)
}

export function deleteActiveEntry(taskId: string): void {
  activeDownloads.delete(taskId)
}

export function hasActiveEntry(taskId: string): boolean {
  return activeDownloads.has(taskId)
}

export function getActiveHlsCount(): number {
  return Array.from(activeDownloads.values()).filter((e) => e.isHls).length
}

function abortActiveEntry(taskId: string): void {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
  }
}

// ===== 状态迁移 =====

export function updateTaskStatus(
  taskId: string,
  status: DownloadTask['status'],
  error?: string
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.status = status
  if (error) task.error = error
  if (status === 'completed' || status === 'failed') {
    task.completedAt = Date.now()
  }

  broadcastDownloadUpdate(task)
  persistTasks()
}

export function updateTaskProgress(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number,
  totalBytes?: number
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.progress = progress
  task.speed = speed
  task.downloadedBytes = downloadedBytes
  if (totalBytes !== undefined && totalBytes > 0) task.totalBytes = totalBytes

  broadcastDownloadUpdate(task)
}

// 页面/offscreen/save-helper 多来源上报进度，可能乱序或字段缺失：
// - 只接受有限数值，忽略 undefined/NaN（防止把任务进度抹成 undefined）
// - progress 单调递增，不允许回退
export async function updateTaskProgressFromPage(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number,
  totalBytes?: number
): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  if (Number.isFinite(progress) && progress > (task.progress ?? 0)) {
    task.progress = progress
  }
  if (Number.isFinite(speed)) task.speed = speed
  if (Number.isFinite(downloadedBytes)) task.downloadedBytes = downloadedBytes
  if (Number.isFinite(totalBytes) && totalBytes > 0) task.totalBytes = totalBytes

  broadcastDownloadUpdate(task)
}

export async function completeDownloadTask(
  taskId: string,
  chromeDownloadId?: number
): Promise<void> {
  activeDownloads.delete(taskId)

  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.status = 'completed'
  task.completedAt = Date.now()
  if (chromeDownloadId) task.chromeDownloadId = chromeDownloadId

  await persistTasks()
  broadcastDownloadUpdate(task)
}

// 从页面/辅助页报告失败：中止活动下载并把任务置为 failed（区别于 cancelDownload 的"已取消"）
export async function failDownloadTask(taskId: string, error?: string): Promise<void> {
  abortActiveEntry(taskId)
  activeDownloads.delete(taskId)
  updateTaskStatus(taskId, 'failed', error || '下载失败')
}

export async function retryDownload(taskId: string): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task || (task.status !== 'failed' && task.status !== 'paused')) return

  task.status = 'pending'
  task.progress = 0
  task.speed = 0
  task.downloadedBytes = 0
  task.error = undefined
  task.startedAt = undefined
  task.completedAt = undefined

  await persistTasks()
  broadcastDownloadUpdate(task)
  requestQueueDrain()
}

export async function pauseDownload(taskId: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
    activeDownloads.delete(taskId)
  }

  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.status = 'paused'
    await persistTasks()
    broadcastDownloadUpdate(task)
  }
}

export async function cancelDownload(taskId: string): Promise<void> {
  abortActiveEntry(taskId)
  activeDownloads.delete(taskId)

  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.status = 'failed'
    task.error = '已取消'
    await persistTasks()
    broadcastDownloadUpdate(task)
  }
}

export async function updateTaskChromeDownloadId(
  taskId: string,
  chromeDownloadId: number
): Promise<void> {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.chromeDownloadId = chromeDownloadId
    const entry = activeDownloads.get(taskId)
    if (entry) entry.chromeDownloadId = chromeDownloadId
  }
}

// ===== 清理变体 =====

export async function clearCompletedDownloads(): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.status !== 'completed' && t.status !== 'failed')
  await persistTasks()
}

export async function clearCompletedFullDownloads(): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.status !== 'completed')
  await persistTasks()
}

export async function clearFailedDownloads(): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.status !== 'failed')
  await persistTasks()
}

export async function clearOrphanedDownloads(openPageUrls: string[]): Promise<void> {
  const urlSet = new Set(openPageUrls)
  downloadQueue = downloadQueue.filter((t) => {
    const pageUrl = t.video.pageUrl
    if (!pageUrl) return true
    return urlSet.has(pageUrl)
  })
  await persistTasks()
}

export async function clearPageDownloads(pageUrl: string): Promise<void> {
  downloadQueue = downloadQueue.filter((t) => t.video.pageUrl !== pageUrl)
  await persistTasks()
}

export async function removeDownloadTask(taskId: string): Promise<void> {
  abortActiveEntry(taskId)
  activeDownloads.delete(taskId)
  downloadQueue = downloadQueue.filter((t) => t.id !== taskId)
  await persistTasks()
}

// ===== 队列驱动观察者（依赖反转：下载器完成后请求调度器再驱动队列） =====

type DrainFn = () => void
const drainListeners = new Set<DrainFn>()

/** 调度器注册：任务完成/失败后需要重新驱动队列 */
export function onQueueDrain(fn: DrainFn): void {
  drainListeners.add(fn)
}

/** 下载执行方调用：某任务已结算，请调度器继续 */
export function requestQueueDrain(): void {
  for (const fn of drainListeners) {
    try {
      fn()
    } catch { /* 调度器异常不传染下载方 */ }
  }
}
