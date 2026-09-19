import { describe, it, expect } from 'vitest'
import type { DetectedVideo, DownloadTask, VideoGroup } from '../types'
import {
  resolutionTier,
  pickVersionByResolution,
  isGroupDownloaded,
  sortTiers,
} from '../utils/resolution'

/**
 * 测试：分辨率档位工具（批量下载的版本择优与组级去重基础）
 *
 * 对应需求：详细面板按指定分辨率筛选后批量下载——
 * 每组只下匹配档位版本（无匹配逐级降档，只向低档回退），
 * 组内任一版本下载过则整组跳过批量（手动单点不受限）。
 */

function video(overrides: Partial<DetectedVideo> = {}): DetectedVideo {
  return {
    id: 'v_' + Math.random().toString(36).slice(2, 8),
    url: 'https://cdn.test/video.mp4',
    title: '测试视频',
    format: 'hls',
    mimeType: 'application/vnd.apple.mpegurl',
    source: 'network',
    pageUrl: 'https://page.test/watch/1',
    domain: 'page.test',
    detectedAt: 1700000000000,
    ...overrides,
  }
}

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'dl_' + Math.random().toString(36).slice(2, 8),
    video: video(),
    status: 'completed',
    progress: 100,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloader: 'chrome',
    ...overrides,
  }
}

function group(versions: DetectedVideo[], title = '测试视频'): VideoGroup {
  return { title, pageUrl: versions[0]?.pageUrl || '', versions, primaryIndex: 0 }
}

describe('resolutionTier（高度归档）', () => {
  it.each([
    [2160, '4k'], [3840, '4k'],
    [1440, '1440p'],
    [1080, '1080p'],
    [720, '720p'],
    [480, '480p'],
    [360, '360p'],
    [359, 'low'], [240, 'low'],
  ])('height=%i → %s', (height, tier) => {
    expect(resolutionTier(height)).toBe(tier)
  })

  it('无高度信息 → null', () => {
    expect(resolutionTier(undefined)).toBeNull()
    expect(resolutionTier(0)).toBeNull()
  })
})

describe('pickVersionByResolution（指定档位择优 + 逐级降档）', () => {
  const versions = [
    video({ id: 'v4k', url: 'https://cdn.test/4k.m3u8', height: 2160 }),
    video({ id: 'v1080', url: 'https://cdn.test/1080.m3u8', height: 1080 }),
    video({ id: 'v720', url: 'https://cdn.test/720.m3u8', height: 720 }),
    video({ id: 'v480', url: 'https://cdn.test/480.m3u8', height: 480 }),
  ]

  it('精确命中', () => {
    expect(pickVersionByResolution(versions, '1080p')?.id).toBe('v1080')
  })

  it('无精确匹配 → 逐级降档到最近的低档', () => {
    expect(pickVersionByResolution(versions, '1440p')?.id).toBe('v1080')
    expect(pickVersionByResolution([versions[0], versions[3]], '1080p')?.id).toBe('v480')
  })

  it('降到底也命中 low 档', () => {
    const lowOnly = [video({ id: 'vlow', height: 240 })]
    expect(pickVersionByResolution(lowOnly, '4k')?.id).toBe('vlow')
  })

  it('组内仅有更高档位 → 不匹配（只向低档回退）', () => {
    const higherOnly = [video({ id: 'v4k', height: 2160 })]
    expect(pickVersionByResolution(higherOnly, '1080p')).toBeUndefined()
  })

  it('未指定档位(any) → undefined，由调用方按整组处理', () => {
    expect(pickVersionByResolution(versions, 'any')).toBeUndefined()
  })
})

describe('isGroupDownloaded（组级已下载判定）', () => {
  const versions = [
    video({ id: 'a', url: 'https://cdn.test/a.m3u8', height: 1080 }),
    video({ id: 'b', url: 'https://cdn.test/b.m3u8', height: 720 }),
  ]
  const g = group(versions)

  it('组内任一版本 URL 有非 failed 任务 → 已下载（A 版本下过，筛 B 版本也跳过）', () => {
    const t = task({ video: video({ url: 'https://cdn.test/b.m3u8' }), status: 'completed' })
    expect(isGroupDownloaded(g, [t])).toBe(true)
  })

  it('downloading / paused 同样视为已下载', () => {
    expect(isGroupDownloaded(g, [task({ video: versions[0], status: 'downloading' })])).toBe(true)
    expect(isGroupDownloaded(g, [task({ video: versions[0], status: 'paused' })])).toBe(true)
  })

  it('failed 任务不算（允许重试重建）', () => {
    expect(isGroupDownloaded(g, [task({ video: versions[0], status: 'failed' })])).toBe(false)
  })

  it('URL 变化（token 刷新）→ 同页面且标题一致仍判定已下载', () => {
    const t = task({
      video: video({
        url: 'https://cdn.test/a.m3u8?n=OLD_TOKEN',
        pageUrl: 'https://page.test/watch/1',
        title: '测试视频',
      }),
    })
    expect(isGroupDownloaded(g, [t])).toBe(true)
  })

  it('同页面但不同视频（标题不同）→ 不算已下载', () => {
    const t = task({
      video: video({ url: 'https://cdn.test/other.m3u8', pageUrl: 'https://page.test/watch/1', title: '另一个视频' }),
    })
    expect(isGroupDownloaded(g, [t])).toBe(false)
  })

  it('完全无关任务 → 不算', () => {
    const t = task({ video: video({ url: 'https://other.test/x.mp4', pageUrl: 'https://other.test/1', title: '无关' }) })
    expect(isGroupDownloaded(g, [t])).toBe(false)
  })

  it('任务记录已清除 → 持久化清单仍记得（URL 命中）', () => {
    const registry = [{ url: 'https://cdn.test/b.m3u8', pageUrl: 'https://other.test/9', title: '别的', at: 1 }]
    expect(isGroupDownloaded(g, [], registry)).toBe(true)
  })

  it('任务记录已清除 → 清单按页面+标题命中（token 变化场景）', () => {
    const registry = [{ url: 'https://cdn.test/NEW_TOKEN.m3u8', pageUrl: 'https://page.test/watch/1', title: '测试视频', at: 1 }]
    expect(isGroupDownloaded(g, [], registry)).toBe(true)
  })

  it('任务与清单都无记录 → 未下载', () => {
    expect(isGroupDownloaded(g, [], [])).toBe(false)
    expect(isGroupDownloaded(g, [])).toBe(false)
  })
})

describe('sortTiers（档位选项排序辅助）', () => {
  it('按档位从高到低排序', () => {
    expect(sortTiers(['480p', '4k', '720p'])).toEqual(['4k', '720p', '480p'])
  })
})
