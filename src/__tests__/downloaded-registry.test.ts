import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 测试：持久化已下载清单 + 按已完成下载移除检测视频的组级匹配器
 *
 * 用户确认的语义：清除已完成记录后，批量下载的组级去重仍要记得
 * "这部视频下过"（清单独立于任务记录）；清除已完成同时把已完成视频
 * 从检测列表组级移除（多版本组任一版本下过即整组移除）。
 */

const storageArea = new Map<string, unknown>()
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => (storageArea.has(key) ? { [key]: storageArea.get(key) } : {}),
      set: async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) storageArea.set(k, v)
      },
      remove: async (key: string) => {
        storageArea.delete(key)
      },
    },
  },
})

const { recordDownloaded, listDownloaded, clearDownloadedRegistry } = await import(
  '../background/downloads/downloaded-registry'
)
const { downloadMatcher } = await import('../utils/storage')

beforeEach(() => {
  storageArea.clear()
})

describe('downloaded-registry（持久化已下载清单）', () => {
  it('记录 → 读取', async () => {
    await recordDownloaded({ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '视频A' })
    const entries = await listDownloaded()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '视频A' })
  })

  it('按 url 去重', async () => {
    await recordDownloaded({ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: 'A' })
    await recordDownloaded({ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/2', title: 'B' })
    expect(await listDownloaded()).toHaveLength(1)
  })

  it('超出 2000 条淘汰最旧', async () => {
    for (let i = 0; i < 2005; i++) {
      await recordDownloaded({ url: `https://cdn.test/${i}.ts` })
    }
    const entries = await listDownloaded()
    expect(entries).toHaveLength(2000)
    expect(entries[0].url).toBe('https://cdn.test/5.ts') // 0-4 被淘汰
  })

  it('清除清单', async () => {
    await recordDownloaded({ url: 'https://cdn.test/a.ts' })
    await clearDownloadedRegistry()
    expect(await listDownloaded()).toEqual([])
  })
})

describe('downloadMatcher（组级移除匹配器）', () => {
  it('URL 命中 + 同页面同标题命中（多版本组任一版本下过即整组命中）', () => {
    const completed = [{ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '视频A' }]
    const matched = downloadMatcher(completed)
    // 兄弟版本：URL 不同，但页面+标题一致
    expect(matched({ url: 'https://cdn.test/b.m3u8', pageUrl: 'https://p.test/1', title: '视频A' })).toBe(true)
    // URL 命中
    expect(matched({ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://other/2', title: '别 的' })).toBe(true)
    // 同页不同视频
    expect(matched({ url: 'https://cdn.test/c.m3u8', pageUrl: 'https://p.test/1', title: '视频C' })).toBe(false)
  })

  it('未命名/空标题不参与标题判等（防同页误杀），仅 URL 兜底', () => {
    const completed = [{ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '未命名' }]
    const matched = downloadMatcher(completed)
    expect(matched({ url: 'https://cdn.test/other.m3u8', pageUrl: 'https://p.test/1', title: '未命名' })).toBe(false)
    expect(matched({ url: 'https://cdn.test/a.m3u8', pageUrl: 'https://p.test/1', title: '未命名' })).toBe(true)
  })
})
