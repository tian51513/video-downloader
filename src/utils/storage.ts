import { DEFAULT_SETTINGS, type AppSettings } from '../types'

/** 设置存储 key（唯一定义点；settings-store 的 onChanged 监听也用它） */
export const SETTINGS_KEY = 'app-settings'
const VIDEOS_KEY = 'detected-videos'
const DOWNLOADS_KEY = 'download-tasks'

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  const stored = result[SETTINGS_KEY] as Partial<AppSettings> | undefined
  if (!stored) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...stored }
}

/** SW 启动时补写默认设置（仅在键缺失时；原 background/settings.ts 转发层已并入） */
export async function initDefaultSettings(): Promise<void> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  if (!result[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS })
  }
}

export async function updateSettings(
  partial: Partial<AppSettings>
): Promise<void> {
  const current = await getSettings()
  const updated = { ...current, ...partial }
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated })
}

export async function saveVideos(
  pageUrl: string,
  videos: any[]
): Promise<void> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  all[pageUrl] = videos
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

export async function getVideos(pageUrl: string): Promise<any[]> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  return all[pageUrl] || []
}

export async function getAllVideos(): Promise<any[]> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  return Object.values(all).flat()
}

export async function clearAllVideos(): Promise<void> {
  await chrome.storage.local.remove(VIDEOS_KEY)
}

export async function clearVideos(pageUrl: string): Promise<void> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  delete all[pageUrl]
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

export async function clearOrphanedVideos(openPageUrls: string[]): Promise<void> {
  const urlSet = new Set(openPageUrls)
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  for (const pageUrl of Object.keys(all)) {
    if (!urlSet.has(pageUrl)) {
      delete all[pageUrl]
    }
  }
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

export async function removeVideosByUrls(urls: string[]): Promise<void> {
  if (urls.length === 0) return
  const urlSet = new Set(urls)
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  for (const pageUrl of Object.keys(all)) {
    const before = all[pageUrl].length
    all[pageUrl] = all[pageUrl].filter((v: any) => !urlSet.has(v.url))
    if (all[pageUrl].length === 0) {
      delete all[pageUrl]
    }
  }
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

/**
 * 构造"命中任一已完成下载"的判定（组级）：URL 命中或"同页面+同标题"命中——
 * 多版本组里任一版本下过即整组命中（含未下载的兄弟版本）。
 * 标题判等不适用于空标题/"未命名"（同页多个未命名视频会误杀），仅 URL 兜底。
 */
export function downloadMatcher(
  downloads: Array<{ url: string; pageUrl?: string; title?: string }>
): (video: { url: string; pageUrl?: string; title?: string }) => boolean {
  const urls = new Set(downloads.map((d) => d.url))
  const pairs = new Set(
    downloads
      .filter((d) => d.pageUrl && (d.title || '').trim() && d.title?.trim() !== '未命名')
      .map((d) => `${d.pageUrl}|${(d.title || '').trim()}`)
  )
  return (video) =>
    urls.has(video.url) || pairs.has(`${video.pageUrl}|${(video.title || '').trim()}`)
}

/**
 * 按已完成下载移除检测视频（storage 持久层，组级语义见 downloadMatcher）
 */
export async function removeVideosByDownloads(
  downloads: Array<{ url: string; pageUrl?: string; title?: string }>
): Promise<void> {
  if (downloads.length === 0) return
  const matched = downloadMatcher(downloads)

  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  for (const pageUrl of Object.keys(all)) {
    all[pageUrl] = all[pageUrl].filter((v: any) => !matched(v))
    if (all[pageUrl].length === 0) {
      delete all[pageUrl]
    }
  }
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

export async function saveDownloads(downloads: any[]): Promise<void> {
  await chrome.storage.local.set({ [DOWNLOADS_KEY]: downloads })
}

export async function getDownloads(): Promise<any[]> {
  const result = await chrome.storage.local.get(DOWNLOADS_KEY)
  return result[DOWNLOADS_KEY] || []
}