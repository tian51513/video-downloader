/**
 * 外部下载器：aria2/Motrix (JSON-RPC) 与 IDM (协议跳转)
 */

import type { DownloadTask } from '../../types'
import {
  deleteActiveEntry,
  updateTaskStatus,
  requestQueueDrain,
} from './task-store'
import { buildDownloadFileName, getExtensionFromFormat } from './naming'

export async function downloadWithAria2(task: DownloadTask, settings: any): Promise<void> {
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
            out: buildDownloadFileName(task.video.title, getExtensionFromFormat(task.video.format)),
            header: task.video.pageUrl ? [`Referer: ${task.video.pageUrl}`] : undefined,
          },
        ],
      }),
    })

    const result = await response.json()
    if (result.error) {
      throw new Error(result.error.message)
    }

    deleteActiveEntry(task.id)
    updateTaskStatus(task.id, 'completed')
    requestQueueDrain()
  } catch (error: any) {
    deleteActiveEntry(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    requestQueueDrain()
  }
}

export async function downloadWithIDM(task: DownloadTask): Promise<void> {
  try {
    const idmUrl = `idm://${encodeURIComponent(task.video.url)}`
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: idmUrl })
    }
    deleteActiveEntry(task.id)
    updateTaskStatus(task.id, 'completed')
    requestQueueDrain()
  } catch (error: any) {
    deleteActiveEntry(task.id)
    updateTaskStatus(task.id, 'failed', error.message)
    requestQueueDrain()
  }
}
