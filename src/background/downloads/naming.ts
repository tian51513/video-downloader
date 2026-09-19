/**
 * 下载文件名构建（叶子模块：仅依赖 storage 读取命名模板）
 */

import { getSettings } from '../../utils/storage'

export function getMimeTypeFromFormat(format: string): string {
  const audioMime: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
  }
  if (audioMime[format]) return audioMime[format]
  if (format === 'ts') return 'video/mp2t'
  return `video/${format}`
}

export function getExtensionFromFormat(format: string): string {
  const map: Record<string, string> = {
    mp4: '.mp4', mkv: '.mkv', webm: '.webm', flv: '.flv', avi: '.avi',
    mov: '.mov', ts: '.ts', blob: '.mp4',
    mp3: '.mp3', m4a: '.m4a', aac: '.aac', flac: '.flac',
    ogg: '.ogg', wav: '.wav', wma: '.wma', opus: '.opus',
  }
  return map[format] || '.mp4'
}

export function buildDownloadFileName(title: string, ext: string): string {
  const template = getNamingTemplateSync()
  const vars: Record<string, string> = {
    name: (title || 'download').replace(/\.[^.]+$/, ''),
    format: ext.replace('.', ''),
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toISOString().slice(11, 19).replace(/:/g, '-'),
    domain: '',
  }

  let fileName = template
  for (const [key, value] of Object.entries(vars)) {
    fileName = fileName.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }

  // 清理文件名
  fileName = fileName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .substring(0, 200)

  // 如果文件名已包含扩展名，不再重复添加
  const extWithDot = ext.startsWith('.') ? ext : `.${ext}`
  if (fileName.endsWith(extWithDot)) return fileName
  return `${fileName}${ext}`
}

let cachedNamingTemplate = '{name}.{format}'
function getNamingTemplateSync(): string {
  return cachedNamingTemplate
}

// 定期刷新命名模板
setInterval(async () => {
  try {
    const settings = await getSettings()
    cachedNamingTemplate = settings.namingTemplate || '{name}.{format}'
  } catch { /* ignore */ }
}, 10000)
