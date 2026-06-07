/**
 * 通过 OffscreenDocument 创建 Blob URL
 *
 * Service Worker 中没有 URL.createObjectURL，
 * 因此创建一个隐藏的 offscreen document 来完成 blob URL 的创建和释放。
 */

const OFFSCREEN_PATH = 'offscreen.html'

let offscreenReady = false

export async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return

  try {
    if (await chrome.offscreen.hasDocument()) {
      offscreenReady = true
      return
    }
  } catch {
    // hasDocument 不可用，尝试直接创建
  }

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_PATH),
    reasons: ['BLOBS'] as any,
    justification: 'Need URL.createObjectURL for saving HLS video segments',
  })

  offscreenReady = true
}

/**
 * 在 offscreen document 中创建 Blob URL
 */
export async function createBlobUrl(data: ArrayBuffer, mimeType: string): Promise<string> {
  await ensureOffscreen()

  const response = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_CREATE_BLOB_URL',
    payload: { data, mimeType },
    _from: 'background',
  })

  if (!response?.url) {
    throw new Error('Offscreen document 未能创建 Blob URL' + (response?.error ? ': ' + response.error : ''))
  }
  return response.url
}

/**
 * 在 offscreen document 中释放 Blob URL
 */
export async function revokeBlobUrl(url: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_REVOKE_BLOB_URL',
      payload: { url },
      _from: 'background',
    })
  } catch {
    // 忽略释放失败（offscreen document 可能已关闭）
  }
}

/**
 * 在 offscreen document 中 fetch 视频 URL 并通过 chrome.downloads.download 保存
 * 使用 new File 创建 blob URL，Chrome 下载时使用 File 的 name 作为文件名。
 * 无需可见标签页。
 *
 * 当 chrome.downloads.download 失败但数据已下载时，
 * 返回 fallbackKey（数据已写入 IndexedDB），调用方可用 save-helper k= 参数避免重复下载。
 */
export async function fetchAndDownload(options: {
  url: string
  referer: string
  mimeType: string
  taskId: string
  filename: string
  saveAs: boolean
}): Promise<{ downloadId?: number; size: number; fallbackKey?: string }> {
  await ensureOffscreen()

  const response = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_FETCH_AND_DOWNLOAD',
    payload: options,
    _from: 'background',
  })

  if (!response?.success) {
    // 数据已下载但 chrome.downloads.save 失败 → 返回 fallbackKey
    if (response?.fallbackKey) {
      return { size: response.size, fallbackKey: response.fallbackKey }
    }
    throw new Error(response?.error || 'Offscreen download failed')
  }

  return { downloadId: response.downloadId, size: response.size }
}
