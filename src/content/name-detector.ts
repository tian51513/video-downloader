import { isGarbled, sanitizeName } from '../utils/sanitize'

export function detectVideoName(): string {
  const title = extractTitle()
  if (title && !isGarbled(title)) return title

  const ogTitle = extractOgTitle()
  if (ogTitle && !isGarbled(ogTitle)) return ogTitle

  const h1 = extractH1()
  if (h1 && !isGarbled(h1)) return h1

  const nearbyText = extractNearbyVideoText()
  if (nearbyText && !isGarbled(nearbyText)) return nearbyText

  const urlName = extractFromUrl()
  if (urlName && !isGarbled(urlName)) return urlName

  return generateFallbackName()
}

function extractTitle(): string {
  return document.title?.trim() || ''
}

function extractOgTitle(): string {
  const ogVideoTitle = document.querySelector('meta[property="og:video:title"]')
  if (ogVideoTitle?.getAttribute('content')?.trim()) {
    return ogVideoTitle.getAttribute('content')!.trim()
  }
  const ogTitle = document.querySelector('meta[property="og:title"]')
  return ogTitle?.getAttribute('content')?.trim() || ''
}

function extractH1(): string {
  const h1 = document.querySelector('h1')
  return h1?.textContent?.trim() || ''
}

function extractNearbyVideoText(): string {
  const video = document.querySelector('video')
  if (!video) return ''

  const parent = video.parentElement
  if (!parent) return ''

  const heading = parent.querySelector('h1, h2, h3, .title, .video-title, [class*="title"]')
  if (heading?.textContent?.trim()) return heading.textContent.trim()

  if (parent.getAttribute('title')?.trim()) return parent.getAttribute('title')!.trim()
  if (video.getAttribute('aria-label')?.trim()) return video.getAttribute('aria-label')!.trim()

  return ''
}

function extractFromUrl(): string {
  const pathname = window.location.pathname
  const segments = pathname.split('/').filter((s) => s && s !== '.')
  if (segments.length === 0) return ''

  let last = segments[segments.length - 1]
  last = last.split('?')[0].split('#')[0]
  last = last.replace(/\.\w+$/, '')
  try { last = decodeURIComponent(last) } catch { /* ignore */ }
  last = last.replace(/[-_]+/g, ' ')

  return last
}

function generateFallbackName(): string {
  const domain = window.location.hostname.replace('www.', '')
  const date = new Date()
  const timestamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('')

  return sanitizeName(`${domain}_${timestamp}`)
}

export function buildVideoFileName(
  detectedTitle: string,
  format: string,
  template: string,
  extraVars?: Record<string, string>
): string {
  const vars: Record<string, string> = {
    name: detectedTitle || generateFallbackName(),
    domain: window.location.hostname.replace('www.', ''),
    date: new Date().toISOString().split('T')[0],
    format: format === 'hls' ? 'mp4' : format === 'dash' ? 'mp4' : format,
    ...extraVars,
  }

  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }

  return sanitizeName(result)
}