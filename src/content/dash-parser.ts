import type { DetectedVideo } from '../types'
import { generateVideoFingerprint } from '../utils/hash'

type ParserCallback = (videos: DetectedVideo[]) => void

interface DASHAdaptationSet {
  mimeType: string
  codecs?: string
  bandwidth?: number
  width?: number
  height?: number
}

function parseMPD(xml: string): DASHAdaptationSet[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    console.error('[VideoDownloader] MPD parse error:', parseError.textContent)
    return []
  }

  const mpd = doc.querySelector('MPD')
  if (!mpd) return []

  const period = mpd.querySelector('Period')
  if (!period) return []

  const adaptationSets: DASHAdaptationSet[] = []
  const sets = period.querySelectorAll('AdaptationSet')

  for (const set of sets) {
    const mimeType = set.getAttribute('mimeType') || ''
    const codecs = set.getAttribute('codecs') || undefined

    const representations = set.querySelectorAll('Representation')
    for (const rep of representations) {
      const repInfo: DASHAdaptationSet = {
        mimeType,
        codecs,
        bandwidth: parseInt(rep.getAttribute('bandwidth') || '0', 10),
        width: rep.getAttribute('width') ? parseInt(rep.getAttribute('width')!, 10) : undefined,
        height: rep.getAttribute('height') ? parseInt(rep.getAttribute('height')!, 10) : undefined,
      }

      if (repInfo.mimeType?.startsWith('video/')) {
        adaptationSets.push(repInfo)
      }
    }
  }

  return adaptationSets
}

export async function parseDASH(
  mpdUrl: string,
  pageUrl: string,
  callback: ParserCallback
): Promise<void> {
  try {
    const response = await fetch(mpdUrl)
    if (!response.ok) return

    const xml = await response.text()
    const adaptationSets = parseMPD(xml)
    if (adaptationSets.length === 0) return

    const videos: DetectedVideo[] = []

    // Group by resolution, keep highest bandwidth per resolution
    const bestByResolution = new Map<string, DASHAdaptationSet>()
    for (const set of adaptationSets) {
      const resKey = set.height ? `${set.height}p` : 'unknown'
      const existing = bestByResolution.get(resKey)
      if (!existing || (set.bandwidth && existing.bandwidth && set.bandwidth > existing.bandwidth)) {
        bestByResolution.set(resKey, set)
      }
    }

    for (const [quality, set] of bestByResolution) {
      const id = await generateVideoFingerprint(mpdUrl, quality)

      videos.push({
        id,
        url: mpdUrl,
        title: '',
        format: 'dash',
        mimeType: set.mimeType || 'application/dash+xml',
        size: undefined,
        width: set.width,
        height: set.height,
        bitrate: set.bandwidth,
        source: 'network',
        pageUrl,
        domain: new URL(pageUrl).hostname,
        detectedAt: Date.now(),
      })
    }

    callback(videos)
  } catch (error) {
    console.error('[VideoDownloader] DASH parse error:', error)
  }
}