/**
 * 已下载清单（持久化，叶子模块）
 *
 * 下载完成时写入 chrome.storage.local，独立于下载任务记录——
 * 「清除已完成」等记录清理不触碰本清单，批量下载的组级去重
 * （utils/resolution.isGroupDownloaded 的 registry 参数）据此记忆
 * "这部视频下过"，避免清记录后批量重复下载。
 *
 * 上限 2000 条，超出淘汰最旧；按 url 去重。所有操作静默容错
 * （清单失效不应影响下载主流程）。
 */

const REGISTRY_KEY = 'downloaded-registry'
const MAX_ENTRIES = 2000

export interface DownloadedEntry {
  url: string
  pageUrl: string
  title: string
  at: number
}

export async function listDownloaded(): Promise<DownloadedEntry[]> {
  try {
    const result = await chrome.storage.local.get(REGISTRY_KEY)
    return (result?.[REGISTRY_KEY] as DownloadedEntry[]) || []
  } catch {
    return []
  }
}

export async function recordDownloaded(video: {
  url: string
  pageUrl?: string
  title?: string
}): Promise<void> {
  if (!video?.url) return
  try {
    const entries = await listDownloaded()
    if (entries.some((e) => e.url === video.url)) return
    entries.push({
      url: video.url,
      pageUrl: video.pageUrl || '',
      title: (video.title || '').trim(),
      at: Date.now(),
    })
    // 超上限淘汰最旧
    const trimmed = entries.length > MAX_ENTRIES
      ? entries.slice(entries.length - MAX_ENTRIES)
      : entries
    await chrome.storage.local.set({ [REGISTRY_KEY]: trimmed })
  } catch {
    /* 存储不可用时静默跳过 */
  }
}

export async function clearDownloadedRegistry(): Promise<void> {
  try {
    await chrome.storage.local.remove(REGISTRY_KEY)
  } catch {
    /* ignore */
  }
}
