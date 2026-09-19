/**
 * 标题兜底工具（纯函数，无 chrome / DOM / fetch 依赖，可单测）
 *
 * 下载文件名的标题清洗管线：
 *   原始 title → [looksLikeFallback 判定是否回退名]
 *             → [是则用页面标题 / extractNameFromUrl 兜底]
 *             → cleanSiteTitleSuffix 去站名后缀
 */

/** 判断标题是否是自动生成的回退名（无语义，不适合做文件名） */
export function looksLikeFallback(title: string): boolean {
  if (!title) return true
  // 自动生成的回退名模式
  if (/^(hls|video)_\d+$/.test(title)) return true
  // 纯数字 ID
  if (/^\d{6,}$/.test(title)) return true
  // hash 类 ID (如 simpleId 产物)
  if (/^[a-z0-9]+_\d+$/.test(title)) return true
  // domain_timestamp 模式
  if (/^.+_\d{14}$/.test(title)) return true
  // UUID 格式 (如 xhamster.com 页面初始标题)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title.trim())) return true
  return false
}

/** 清理站点标题后缀（去除 " | site"、" – tags | site" 等） */
export function cleanSiteTitleSuffix(title: string): string {
  // "标题 – tags/categories | site" 模式 (xhamster 等)
  // 必须同时有 " | " 分隔符才视为站点标题模式
  const pipeIdx = title.lastIndexOf(' | ')
  if (pipeIdx > 0) {
    const before = title.substring(0, pipeIdx).trim()
    const dashIdx = before.lastIndexOf(' – ')
    if (dashIdx > 0) {
      const candidate = before.substring(0, dashIdx).trim()
      if (candidate.length > 3) return candidate
    }
    if (before.length > 3) return before
  }
  // 没有 " | " 模式时不动标题（og:title 通常已经是干净的）
  return title
}

/** 从 URL 路径提取可读名称（取最后一段，连字符/下划线转空格）；提不出则用域名 */
export function extractNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter((s) => s && s !== '.')
    if (segments.length > 0) {
      let last = segments[segments.length - 1].split('?')[0].split('#')[0]
      last = last.replace(/\.\w+$/, '')
      try { last = decodeURIComponent(last) } catch { /* ignore */ }
      last = last.replace(/[-_]+/g, ' ')
      if (last && last.length > 2 && !/^\d+$/.test(last)) return last
    }
    return parsed.hostname.replace('www.', '')
  } catch {
    return ''
  }
}
