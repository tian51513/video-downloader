export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '未知'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  if (i === 0) return `${bytes} B`
  return `${size.toFixed(i <= 2 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '未知'
  if (!isFinite(seconds) || seconds < 0) return '未知'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return '未知'
  return `${width}x${height}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatFileSize(bytesPerSecond)}/s`
}

export function formatBitrate(bitrate?: number): string {
  if (!bitrate) return '未知'
  if (bitrate >= 1_000_000) return `${(bitrate / 1_000_000).toFixed(1)} Mbps`
  if (bitrate >= 1_000) return `${(bitrate / 1_000).toFixed(0)} Kbps`
  return `${bitrate} bps`
}

export function formatProgress(progress: number): string {
  return `${Math.min(100, Math.max(0, progress)).toFixed(1)}%`
}

export function getResolutionLabel(width?: number, height?: number): string {
  if (!height) return ''
  if (height >= 2160) return '4K'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  if (height >= 480) return '480p'
  if (height >= 360) return '360p'
  return `${height}p`
}