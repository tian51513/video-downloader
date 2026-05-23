import { create } from 'zustand'
import type { DetectedVideo, VideoFilter, VideoGroup } from '../types'

const AUDIO_FORMATS_SET = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'opus'])

function isAudioFormat(format: string): boolean {
  return AUDIO_FORMATS_SET.has(format)
}

function sanitizeTitle(title: string): string {
  if (!title || title.trim().length === 0) return ''
  if (/^\d{4,}$/.test(title.trim())) return ''
  if (/^[0-9a-f]{16,}$/i.test(title.trim())) return ''
  return title.trim()
}

interface VideoState {
  videos: DetectedVideo[]
  filteredVideos: DetectedVideo[]
  videoGroups: VideoGroup[]
  filteredGroups: VideoGroup[]
  isDetecting: boolean
  currentFilter: VideoFilter

  setVideos: (videos: DetectedVideo[]) => void
  addVideo: (video: DetectedVideo) => void
  clearVideos: () => void
  clearCurrentPageVideos: (pageUrl: string) => void
  clearOrphanedVideos: (openPageUrls: string[]) => void
  clearVideosByUrls: (urls: string[]) => void
  setDetecting: (isDetecting: boolean) => void
  setFilter: (filter: Partial<VideoFilter>) => void
  applyFilter: () => void
  buildGroups: (source: DetectedVideo[]) => VideoGroup[]
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  filteredVideos: [],
  videoGroups: [],
  filteredGroups: [],
  isDetecting: false,
  currentFilter: {
    formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash', 'blob', 'ts', 'mp3', 'm4a', 'flac', 'ogg', 'wav'],
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
    set({ videos: [], filteredVideos: [], videoGroups: [], filteredGroups: [] })
  },

  clearCurrentPageVideos: (pageUrl) => {
    set((state) => ({
      videos: state.videos.filter((v) => v.pageUrl !== pageUrl),
    }))
    get().applyFilter()
  },

  clearOrphanedVideos: (openPageUrls) => {
    const urlSet = new Set(openPageUrls)
    set((state) => ({
      videos: state.videos.filter((v) => {
        if (!v.pageUrl) return true
        return urlSet.has(v.pageUrl)
      }),
    }))
    get().applyFilter()
  },

  clearVideosByUrls: (urls) => {
    const urlSet = new Set(urls)
    set((state) => ({
      videos: state.videos.filter((v) => !urlSet.has(v.url)),
    }))
    get().applyFilter()
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

  buildGroups: (source) => {
    const map = new Map<string, DetectedVideo[]>()
    const ungrouped: DetectedVideo[] = []

    for (const video of source) {
      const title = sanitizeTitle(video.title)
      if (!title) {
        ungrouped.push(video)
        continue
      }
      const key = `${title}|||${video.pageUrl}`
      let group = map.get(key)
      if (!group) {
        group = []
        map.set(key, group)
      }
      group.push(video)
    }

    const groups: VideoGroup[] = []

    // 多版本分组
    for (const [, versions] of map) {
      if (versions.length === 1) {
        // 单版本也封装为 group
        groups.push({
          title: sanitizeTitle(versions[0].title),
          pageUrl: versions[0].pageUrl,
          versions: [versions[0]],
          primaryIndex: 0,
        })
      } else {
        // 多版本：排序
        const isAudio = isAudioFormat(versions[0].format)
        const sorted = [...versions]
        if (isAudio) {
          // 音频：按码率降序，再按采样率降序
          sorted.sort((a, b) => {
            const br = (b.bitrate || 0) - (a.bitrate || 0)
            if (br !== 0) return br
            return (b.sampleRate || 0) - (a.sampleRate || 0)
          })
        } else {
          // 视频：按分辨率降序，再按大小降序
          sorted.sort((a, b) => {
            const h = (b.height || 0) - (a.height || 0)
            if (h !== 0) return h
            return (b.size || 0) - (a.size || 0)
          })
        }
        groups.push({
          title: sanitizeTitle(versions[0].title),
          pageUrl: versions[0].pageUrl,
          versions: sorted,
          primaryIndex: 0,
        })
      }
    }

    // 无标题的视频各自独立
    for (const video of ungrouped) {
      groups.push({
        title: video.title || '未命名',
        pageUrl: video.pageUrl,
        versions: [video],
        primaryIndex: 0,
      })
    }

    return groups
  },

  applyFilter: () => {
    const { videos, currentFilter } = get()
    let result = [...videos]

    if (currentFilter.formats.length > 0) {
      result = result.filter((v) => currentFilter.formats.includes(v.format))
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
        audio: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'opus'],
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

    // 构建分组
    const groups = get().buildGroups(result)
    set({ videoGroups: groups, filteredGroups: groups })
  },
}))
