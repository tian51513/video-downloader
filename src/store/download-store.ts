import { create } from 'zustand'
import type { DownloadTask, DownloadStatus } from '../types'

interface DownloadState {
  tasks: DownloadTask[]
  addTask: (task: DownloadTask) => void
  updateTask: (id: string, update: Partial<DownloadTask>) => void
  updateProgress: (id: string, progress: number, speed: number, downloadedBytes: number, totalBytes?: number) => void
  updateStatus: (id: string, status: DownloadStatus, error?: string) => void
  updateTaskChromeDownloadId: (id: string, chromeDownloadId: number) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  clearCompletedFull: () => void
  clearFailed: () => void
  clearByStatus: (status: DownloadStatus) => void
  clearOrphanedTasks: (openPageUrls: string[]) => void
  clearPageTasks: (pageUrl: string) => void
  getTask: (id: string) => DownloadTask | undefined
  getTasksByStatus: (status: DownloadStatus) => DownloadTask[]
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === task.id)
      if (idx >= 0) {
        const next = [...state.tasks]
        next[idx] = task
        return { tasks: next }
      }
      return { tasks: [...state.tasks, task] }
    })
  },

  updateTask: (id, update) => {
    set((state) => ({
      tasks: state.tasks.map((t) => t.id === id ? { ...t, ...update } : t),
    }))
  },

  updateProgress: (id, progress, speed, downloadedBytes, totalBytes) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, progress, speed, downloadedBytes, ...(totalBytes !== undefined ? { totalBytes } : {}) } : t
      ),
    }))
  },

  updateStatus: (id, status, error) => {
    const now = Date.now()
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== id) return t
        const update: Partial<DownloadTask> = { status }
        if (error) update.error = error
        if (status === 'downloading' && !t.startedAt) update.startedAt = now
        if (status === 'completed' || status === 'failed') update.completedAt = now
        return { ...t, ...update }
      }),
    }))
  },

  updateTaskChromeDownloadId: (id, chromeDownloadId) => {
    set((state) => ({
      tasks: state.tasks.map((t) => t.id === id ? { ...t, chromeDownloadId } : t),
    }))
  },

  removeTask: (id) => {
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status !== 'completed' && t.status !== 'failed'
      ),
    }))
  },

  clearCompletedFull: () => {
    set((state) => {
      // 找出所有已完成任务的 video title
      const completedTitles = new Set(
        state.tasks.filter((t) => t.status === 'completed').map((t) => t.video.title)
      )
      if (completedTitles.size === 0) return state
      // 清除所有与已完成任务同 title 的任务（包括未完成的）
      return {
        tasks: state.tasks.filter((t) => !completedTitles.has(t.video.title)),
      }
    })
  },

  clearFailed: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status !== 'failed'),
    }))
  },

  clearByStatus: (status) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status !== status),
    }))
  },

  clearOrphanedTasks: (openPageUrls) => {
    const urlSet = new Set(openPageUrls)
    set((state) => ({
      tasks: state.tasks.filter((t) => {
        const pageUrl = t.video.pageUrl
        if (!pageUrl) return true // 保留无页面信息的任务
        return urlSet.has(pageUrl)
      }),
    }))
  },

  clearPageTasks: (pageUrl) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.video.pageUrl !== pageUrl),
    }))
  },

  getTask: (id) => {
    return get().tasks.find((t) => t.id === id)
  },

  getTasksByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status)
  },
}))
