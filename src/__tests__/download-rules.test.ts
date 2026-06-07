import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Chrome API (must be complete - download-manager references chrome at module top level)
const mockUpdateSessionRules = vi.fn()
const updateRuleCalls: any[] = []

vi.stubGlobal('chrome', {
  declarativeNetRequest: {
    updateSessionRules: (...args: any[]) => {
      updateRuleCalls.push(args[0])
      return mockUpdateSessionRules(...args)
    },
  },
  downloads: {
    onDeterminingFilename: { addListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(),
    getViews: vi.fn(() => []),
    getURL: vi.fn((path) => `chrome-extension://fake-id/${path}`),
    lastError: undefined,
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
  },
})

const { addDownloadRules, removeDownloadRules } = await import('../background/download-manager')

describe('addDownloadRules', () => {
  beforeEach(() => {
    updateRuleCalls.length = 0
    // 清理上一次调用留下的规则状态
    // 需要先 remove 再 add
  })

  it('adds a rule to remove Content-Disposition header', async () => {
    await addDownloadRules(
      'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      'https://www.85po.com/v/21417/ri-o/'
    )

    expect(updateRuleCalls.length).toBeGreaterThanOrEqual(1)
    const lastCall = updateRuleCalls[updateRuleCalls.length - 1]
    const removeRule = lastCall.addRules.find(
      (r: any) =>
        r.action?.responseHeaders?.some(
          (h: any) => h.header === 'Content-Disposition' && h.operation === 'remove'
        )
    )
    expect(removeRule).toBeDefined()
  })

  it('adds a rule to set Referer header', async () => {
    await addDownloadRules(
      'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      'https://www.85po.com/v/21417/ri-o/'
    )

    const lastCall = updateRuleCalls[updateRuleCalls.length - 1]
    const refererRule = lastCall.addRules.find(
      (r: any) =>
        r.action?.requestHeaders?.some(
          (h: any) => h.header === 'Referer' && h.operation === 'set'
        )
    )
    expect(refererRule).toBeDefined()
    expect(refererRule.action.requestHeaders[0].value).toBe('https://www.85po.com/v/21417/ri-o/')
  })

  it('uses other resource type for chrome.downloads requests', async () => {
    await addDownloadRules(
      'https://www.85po.com/get_file/3/1eade9eb/21000/21417.mp4',
      'https://www.85po.com/v/21417/ri-o/'
    )

    const lastCall = updateRuleCalls[updateRuleCalls.length - 1]
    for (const rule of lastCall.addRules) {
      expect(rule.condition.resourceTypes).toContain('other')
    }
  })

  it('does not add rules for blob: URLs', async () => {
    await addDownloadRules('blob:uuid-here', 'https://example.com/')

    // blob URLs 应该被跳过 — 不应添加任何规则
    // 无任何 updateSessionRules 调用（因为没有旧规则需要清理，也没有新规则需要添加）
    const addRuleCalls = updateRuleCalls.filter((c: any) => c.addRules?.length > 0)
    expect(addRuleCalls.length).toBe(0)
  })
})
