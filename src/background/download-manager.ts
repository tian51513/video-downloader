import type {
  DetectedVideo,
  DownloadTask,
  DownloadSettings,
  DownloaderType,
} from '../types'
import { getFullSettings } from './settings'
import { saveDownloads, getDownloads } from '../utils/storage'

let activeDownloads: Map<string, { abortController?: AbortController }> = new Map()
let downloadQueue: DownloadTask[] = []
let isProcessing = false

export async function createDownloadTask(
  video: DetectedVideo,
  downloader: DownloaderType
): Promise<DownloadTask> {
  const settings = await getFullSettings()

  const task: DownloadTask = {
    id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    video,
    status: 'pending',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: video.size || 0,
    downloader,
  }

  downloadQueue.push(task)
  await persistTasks()
  broadcastDownloadUpdate(task)
  processQueue()

  return task
}

async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  while (true) {
    const settings = await getFullSettings()
    const { maxConcurrent } = settings.downloadSettings
    const activeCount = activeDownloads.size
    if (activeCount >= maxConcurrent) break

    const next = downloadQueue.find((t) => t.status === 'pending')
    if (!next) break

    updateTaskStatus(next.id, 'downloading')

    switch (next.downloader) {
      case 'chrome':
        await downloadWithChrome(next)
        break
      case 'aria2':
        await downloadWithAria2(next)
        break
      case 'idm':
        await downloadWithIDM(next)
        break
      case 'motrix':
        await downloadWithAria2(next) // Motrix uses aria2-compatible RPC
        break
      default:
        await downloadWithChrome(next)
    }
  }

  isProcessing = false
}

async function downloadWithChrome(task: DownloadTask): Promise<void> {
  const abortController = new AbortController()
  activeDownloads.set(task.id, { abortController })

  try {
    const downloadId = await chrome.downloads.download({
      url: task.video.url,
      filename: task.filePath || undefined,
      conflictAction: 'uniquify',
    })

    setupDownloadProgress(task.id, downloadId)

    chrome.downloads.onChanged.addListener(function listener(delta) {
      if (delta.id !== downloadId) return

      if (delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener)
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'completed')
        processQueue()
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener)
        activeDownloads.delete(task.id)
        updateTaskStatus(task.id, 'failed', delta.error?.current)
        processQueue()
      }
    })
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

function setupDownloadProgress(taskId: string, downloadId: number): void {
  const interval = setInterval(async () => {
    if (!activeDownloads.has(taskId)) {
      clearInterval(interval)
      return
    }

    try {
      const results = await chrome.downloads.search({ id: downloadId })
      if (results.length > 0) {
        const dl = results[0]
        const progress = dl.totalBytes > 0 ? (dl.bytesReceived / dl.totalBytes) * 100 : 0
        updateTaskProgress(taskId, progress, 0, dl.bytesReceived)
      }
    } catch {
      clearInterval(interval)
    }
  }, 1000)
}

async function downloadWithAria2(task: DownloadTask): Promise<void> {
  const settings = await getFullSettings()
  const config = settings.externalDownloaderConfig

  try {
    const response = await fetch(config.aria2RpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: task.id,
        method: 'aria2.addUri',
        params: [
          [task.video.url],
          {
            dir: settings.baseSaveDirectory || undefined,
            out: task.video.title
              ? `${task.video.title}.mp4`
              : undefined,
          },
        ],
      }),
    })

    const result = await response.json()
    if (result.error) {
      updateTaskStatus(task.id, 'failed', result.error.message)
    } else {
      updateTaskStatus(task.id, 'completed')
    }

    activeDownloads.delete(task.id)
    processQueue()
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

async function downloadWithIDM(task: DownloadTask): Promise<void> {
  try {
    const idmUrl = `idm://${encodeURIComponent(task.video.url)}`
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: idmUrl })
    }
    updateTaskStatus(task.id, 'completed')
    activeDownloads.delete(task.id)
    processQueue()
  } catch (error: any) {
    activeDownloads.delete(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    processQueue()
  }
}

export async function pauseDownload(taskId: string): Promise<void> {
  updateTaskStatus(taskId, 'paused')
}

export async function cancelDownload(taskId: string): Promise<void> {
  const entry = activeDownloads.get(taskId)
  if (entry?.abortController) {
    entry.abortController.abort()
  }
  activeDownloads.delete(taskId)

  const task = downloadQueue.find((t) => t.id === taskId)
  if (task) {
    task.status = 'failed'
    task.error = '已取消'
  }

  await persistTasks()
  broadcastDownloadUpdate(task!)
}

function updateTaskStatus(
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

function updateTaskProgress(
  taskId: string,
  progress: number,
  speed: number,
  downloadedBytes: number
): void {
  const task = downloadQueue.find((t) => t.id === taskId)
  if (!task) return

  task.progress = progress
  task.speed = speed
  task.downloadedBytes = downloadedBytes

  broadcastDownloadUpdate(task)
}

function broadcastDownloadUpdate(task: DownloadTask): void {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    payload: task,
  }).catch(() => {})
}

async function persistTasks(): Promise<void> {
  await saveDownloads(downloadQueue)
}

export async function getAllDownloadTasks(): Promise<DownloadTask[]> {
  downloadQueue = await getDownloads()
  return downloadQueue
}
