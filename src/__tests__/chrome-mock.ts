import { vi } from 'vitest'

/**
 * chrome.* 测试 mock 工厂（权威版）
 *
 * 此前每个测试文件手搓各自的 chrome stub，完整度不一（缺 tabs/scripting
 * 的 mock 会让被测代码静默走错分支），实现改了 mock 还停在旧协议——mock
 * 漂移即测试漂移。所有测试统一从这里取 mock，通过 options 覆盖行为。
 */

export interface ChromeMockOptions {
  /** chrome.downloads.download 行为。默认：Promise 风格解析下载 id 101（Layer 1 成功） */
  downloadsDownload?: (options: any) => number | Promise<number> | undefined
  /** chrome.runtime.sendMessage 行为。默认：SAVE_HELPER_FETCH_DOWNLOAD 快速失败，其余 resolve({}) */
  runtimeSendMessage?: (message: any) => any
  /** chrome.tabs.sendMessage 返回。默认 resolve(undefined)（Layer 3 无接收方快速失败） */
  tabsSendMessage?: (tabId: number, message: any) => any
}

export function createChromeMock(options: ChromeMockOptions = {}) {
  const downloadCalls: any[] = []
  const onChangedListeners: Function[] = []
  const updateRuleCalls: any[] = []
  const tabsCreated: any[] = []

  const chrome = {
    downloads: {
      download: vi.fn((opts: any) => {
        downloadCalls.push(opts)
        const result = options.downloadsDownload
          ? options.downloadsDownload(opts)
          : Promise.resolve(101)
        return result
      }),
      search: vi.fn(() => Promise.resolve([{ totalBytes: 100, bytesReceived: 100 }])),
      onChanged: {
        addListener: vi.fn((l: Function) => onChangedListeners.push(l)),
        removeListener: vi.fn(),
      },
      onDeterminingFilename: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn((message: any) => {
        if (options.runtimeSendMessage) return options.runtimeSendMessage(message)
        // Layer 4 (save-helper)：无接收方 → 快速失败，避免降级链/测试进程悬挂
        if (message?.type === 'SAVE_HELPER_FETCH_DOWNLOAD') {
          return Promise.reject(new Error('no receiver'))
        }
        return Promise.resolve({})
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      getViews: vi.fn(() => []),
      getURL: vi.fn((path: string) => `chrome-extension://fake-id/${path}`),
      lastError: undefined,
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 1 }])),
      get: vi.fn(() =>
        Promise.resolve({ id: 1, url: 'https://www.85po.com/v/21417/ri-o/' })
      ),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn((tabId: number, message: any) => {
        if (options.tabsSendMessage) return options.tabsSendMessage(tabId, message)
        return Promise.resolve(undefined)
      }),
      create: vi.fn((props: any) => {
        tabsCreated.push(props)
        return Promise.resolve({ id: 999 })
      }),
      update: vi.fn(() => Promise.resolve({})),
    },
    offscreen: {
      hasDocument: vi.fn(() => Promise.resolve(true)),
      createDocument: vi.fn(() => Promise.resolve()),
    },
    declarativeNetRequest: {
      updateSessionRules: vi.fn((args: any) => {
        updateRuleCalls.push(args)
        return Promise.resolve()
      }),
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ result: 'test title' }])),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    contextMenus: {
      removeAll: vi.fn((cb?: () => void) => cb?.()),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    sidePanel: {
      open: vi.fn(() => Promise.resolve()),
      setOptions: vi.fn(() => Promise.resolve()),
    },
  }

  return { chrome, downloadCalls, onChangedListeners, updateRuleCalls, tabsCreated }
}
