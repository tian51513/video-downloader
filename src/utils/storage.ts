import { DEFAULT_SETTINGS, type AppSettings } from '../types'

const SETTINGS_KEY = 'app-settings'
const VIDEOS_KEY = 'detected-videos'
const DOWNLOADS_KEY = 'download-tasks'

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  const stored = result[SETTINGS_KEY] as Partial<AppSettings> | undefined
  if (!stored) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...stored }
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

export async function clearVideos(pageUrl: string): Promise<void> {
  const result = await chrome.storage.local.get(VIDEOS_KEY)
  const all: Record<string, any[]> = result[VIDEOS_KEY] || {}
  delete all[pageUrl]
  await chrome.storage.local.set({ [VIDEOS_KEY]: all })
}

export async function saveDownloads(downloads: any[]): Promise<void> {
  await chrome.storage.local.set({ [DOWNLOADS_KEY]: downloads })
}

export async function getDownloads(): Promise<any[]> {
  const result = await chrome.storage.local.get(DOWNLOADS_KEY)
  return result[DOWNLOADS_KEY] || []
}