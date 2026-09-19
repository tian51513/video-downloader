/**
 * 分辨率档位工具（纯函数，无 chrome/DOM 依赖，可单测）
 *
 * 三件事：
 * - 高度 → 标准档位归并（resolutionTier）
 * - 按指定档位为版本组择优（pickVersionByResolution）：精确匹配 →
 *   逐级降档直到命中，只向低档回退（组内仅有更高档位时该组不参与下载）
 * - 批量下载的组级"已下载"判定（isGroupDownloaded）：组内任一版本有
 *   非 failed 任务即跳过整组——版本切换只能手动单点下载
 */
import type { DetectedVideo, DownloadTask, VideoGroup } from '../types'

export type ResolutionTier = '4k' | '1440p' | '1080p' | '720p' | '480p' | '360p' | 'low'

/** 档位从高到低的顺序（降档匹配方向） */
export const TIER_ORDER: ResolutionTier[] = ['4k', '1440p', '1080p', '720p', '480p', '360p', 'low']

/** 筛选下拉的显示标签 */
export const TIER_LABELS: Record<ResolutionTier, string> = {
  '4k': '4K',
  '1440p': '1440p',
  '1080p': '1080p',
  '720p': '720p',
  '480p': '480p',
  '360p': '360p',
  low: '低于 360p',
}

/** 高度 → 标准档位；无高度信息返回 null */
export function resolutionTier(height?: number): ResolutionTier | null {
  if (!height || height <= 0) return null
  if (height >= 2160) return '4k'
  if (height >= 1440) return '1440p'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  if (height >= 480) return '480p'
  if (height >= 360) return '360p'
  return 'low'
}

/** 档位去重并按从高到低排序（筛选下拉选项用） */
export function sortTiers(tiers: string[]): ResolutionTier[] {
  return TIER_ORDER.filter((t) => tiers.includes(t))
}

/**
 * 为版本组按指定档位择优：精确匹配 → 逐级降档，直到命中。
 * 未指定（'any'/空）返回 undefined，由调用方按整组处理。
 */
export function pickVersionByResolution(
  versions: DetectedVideo[],
  tier: string
): DetectedVideo | undefined {
  if (!tier || tier === 'any') return undefined
  const startIdx = TIER_ORDER.indexOf(tier as ResolutionTier)
  if (startIdx < 0) return undefined
  for (let i = startIdx; i < TIER_ORDER.length; i++) {
    const hit = versions.find((v) => resolutionTier(v.height) === TIER_ORDER[i])
    if (hit) return hit
  }
  return undefined
}

/**
 * 组级已下载判定（批量下载过滤）：
 * - 组内任一版本 URL 有非 failed 任务 → 已下载
 * - 或任务与组同页面(pageUrl)且标题一致 → 已下载——覆盖"下过 A 版本、
 *   token 刷新后 URL 变化再筛 B 版本"的场景；标题判等失败时回退 URL 判定
 * - registry（持久化已下载清单）同语义判定：清除任务记录后仍记得下过
 */
export function isGroupDownloaded(
  group: VideoGroup,
  tasks: DownloadTask[],
  registry?: Array<{ url: string; pageUrl: string; title: string }>
): boolean {
  const groupUrls = new Set(group.versions.map((v) => v.url))
  const groupTitle = group.title.trim()
  const titleMatch = (entry: { pageUrl?: string; title?: string }) =>
    !!(
      entry.pageUrl &&
      entry.pageUrl === group.pageUrl &&
      entry.title?.trim() === groupTitle &&
      groupTitle !== '' && groupTitle !== '未命名'
    )
  if (tasks.some((t) => {
    if (t.status === 'failed') return false
    if (t.video?.url && groupUrls.has(t.video.url)) return true
    return titleMatch(t.video)
  })) {
    return true
  }
  if (registry?.length) {
    return registry.some((e) => (e.url && groupUrls.has(e.url)) || titleMatch(e))
  }
  return false
}
