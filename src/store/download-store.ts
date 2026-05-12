import { create } from 'zustand'
import type { DownloadTask, DownloadStatus } from '../types'

interface DownloadState {
  tasks: DownloadTask[]
  addTask: (task: DownloadTask) => void
  updateTask: (id: string, update: Partial<DownloadTask>) => void
  updateProgress: (id: string, progress: number, speed: number, downloadedBytes: number) => void
  updateStatus: (id: string, status: DownloadStatus, error?: string) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  getTasksByStatus: (status: DownloadStatus) => DownloadTask[]
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    set((state) => ({ tasks: [...state.tasks, task] }))
  },

  updateTask: (id, update) => {
    set((state) => ({
      tasks: state.tasks.map((t) => t.id === id ? { ...t, ...update } : t),
    }))
  },

  updateProgress: (id, progress, speed, downloadedBytes) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, progress, speed, downloadedBytes } : t
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

  getTasksByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status)
  },
}))