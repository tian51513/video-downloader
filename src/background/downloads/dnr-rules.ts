/**
 * DNR 会话规则（叶子模块）：下载前设置 Referer 伪造 + Content-Disposition 移除
 */

import type { DownloadTask } from '../../types'

export async function setupDownloadRules(task: DownloadTask): Promise<void> {
  // DNR 无法拦截 blob:/data: 等 URL，且其 origin 为 "null"，生成的规则是无效规则
  if (!task.video.url.startsWith('http')) {
    return
  }
  const urlObj = new URL(task.video.url)
  const domain = urlObj.hostname
  const pageDomain = task.video.pageUrl ? new URL(task.video.pageUrl).hostname : domain

  try {
    // 添加 Referer（rule ID 必须是正整数）
    const ruleId = Math.abs(hashCode(task.id)) % 2147483647 || 1
    await chrome.declarativeNetRequest.updateSessionRules({
      // 当前 @types/chrome 的 DNR 枚举落后于 Chrome 实际支持的 action/operation/resourceTypes，整体放宽
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: task.video.pageUrl || task.video.url },
          ],
          responseHeaders: [
            { header: 'Content-Disposition', operation: 'remove' },
          ],
        },
        condition: {
          urlFilter: `||${urlObj.origin}`,
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'],
        },
      }] as any,
      removeRuleIds: [ruleId],
    })
  } catch (error) {
    console.warn('[DownloadManager] Failed to set download rules:', error)
  }
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return hash
}
