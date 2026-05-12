import type { DetectedVideo } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type BlobCallback = (video: DetectedVideo) => void

let originalCreateObjectURL: typeof URL.createObjectURL | null = null

export function hookBlobCreation(callback: BlobCallback): void {
  if (originalCreateObjectURL) return

  originalCreateObjectURL = URL.createObjectURL

  URL.createObjectURL = function (blob: Blob) {
    const blobUrl = originalCreateObjectURL!.call(URL, blob)

    if (blob instanceof Blob && blob.type.startsWith('video/')) {
      handleBlobVideo(blobUrl, blob.type, callback)
    }

    return blobUrl
  }
}

async function handleBlobVideo(
  blobUrl: string,
  mimeType: string,
  callback: BlobCallback
): Promise<void> {
  const id = await generateVideoFingerprint(blobUrl, 'blob')

  const video: DetectedVideo = {
    id,
    url: blobUrl,
    title: '',
    format: 'blob',
    mimeType,
    source: 'blob',
    pageUrl: window.location.href,
    domain: window.location.hostname,
    detectedAt: Date.now(),
  }

  callback(video)
}

export function unhookBlobCreation(): void {
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL
    originalCreateObjectURL = null
  }
}