import { create } from 'zustand'
import type { DetectedVideo, VideoFilter } from '../types'

interface VideoState {
  videos: DetectedVideo[]
  filteredVideos: DetectedVideo[]
  isDetecting: boolean
  currentFilter: VideoFilter

  setVideos: (videos: DetectedVideo[]) => void
  addVideo: (video: DetectedVideo) => void
  clearVideos: () => void
  setDetecting: (isDetecting: boolean) => void
  setFilter: (filter: Partial<VideoFilter>) => void
  applyFilter: () => void
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  filteredVideos: [],
  isDetecting: false,
  currentFilter: {
    formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash'],
    minResolution: 'any',
    minSize: 'any',
    minDuration: 'any',
    sources: [],
    videoType: 'all',
    sortBy: 'detectedAt',
    sortOrder: 'desc',
  },

  setVideos: (videos) => {
    set({ videos })
    get().applyFilter()
  },

  addVideo: (video) => {
    const { videos } = get()
    if (videos.some((v) => v.id === video.id)) return
    set({ videos: [...videos, video] })
    get().applyFilter()
  },

  clearVideos: () => {
    set({ videos: [], filteredVideos: [] })
  },

  setDetecting: (isDetecting) => {
    set({ isDetecting })
  },

  setFilter: (filter) => {
    set((state) => ({
      currentFilter: { ...state.currentFilter, ...filter },
    }))
    get().applyFilter()
  },

  applyFilter: () => {
    const { videos, currentFilter } = get()
    let result = [...videos]

    if (currentFilter.formats.length > 0) {
      result = result.filter((v) =>
        currentFilter.formats.includes(v.format)
      )
    }

    const resolutionThresholds: Record<string, number> = {
      '4k': 2160, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360,
    }
    if (currentFilter.minResolution !== 'any' && resolutionThresholds[currentFilter.minResolution]) {
      const threshold = resolutionThresholds[currentFilter.minResolution]
      result = result.filter((v) => v.height && v.height >= threshold)
    }

    const sizeThresholds: Record<string, number> = {
      '10mb': 10 * 1024 * 1024, '50mb': 50 * 1024 * 1024,
      '100mb': 100 * 1024 * 1024, '500mb': 500 * 1024 * 1024,
    }
    if (currentFilter.minSize !== 'any' && sizeThresholds[currentFilter.minSize]) {
      const threshold = sizeThresholds[currentFilter.minSize]
      result = result.filter((v) => v.size && v.size >= threshold)
    }

    const durationThresholds: Record<string, number> = {
      '1min': 60, '5min': 300, '10min': 600, '30min': 1800,
    }
    if (currentFilter.minDuration !== 'any' && durationThresholds[currentFilter.minDuration]) {
      const threshold = durationThresholds[currentFilter.minDuration]
      result = result.filter((v) => v.duration && v.duration >= threshold)
    }

    if (currentFilter.sources.length > 0) {
      result = result.filter((v) => currentFilter.sources.includes(v.domain))
    }

    if (currentFilter.videoType !== 'all') {
      const typeMap: Record<string, string[]> = {
        regular: ['mp4', 'mkv', 'flv', 'avi', 'rmvb', 'rm', 'webm', 'mov', 'ts'],
        streaming: ['hls', 'dash'],
        blob: ['blob'],
      }
      result = result.filter((v) => typeMap[currentFilter.videoType]?.includes(v.format))
    }

    const { sortBy, sortOrder } = currentFilter
    result.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'size': cmp = (a.size || 0) - (b.size || 0); break
        case 'resolution': cmp = (a.height || 0) - (b.height || 0); break
        case 'duration': cmp = (a.duration || 0) - (b.duration || 0); break
        case 'detectedAt': default: cmp = a.detectedAt - b.detectedAt; break
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })

    set({ filteredVideos: result })
  },
}))