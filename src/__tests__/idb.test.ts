import { describe, it, expect, vi } from 'vitest'
import 'fake-indexeddb/auto'

/**
 * 测试：IndexedDB 深模块（utils/idb）
 *
 * 覆盖此前 5 处复制样板中最易碎的路径：
 * 1. 全新数据库：store 自动创建，put/get 往返
 * 2. 已存在但缺 store 的旧库：升版本重开补建（onupgradeneeded 陷阱）
 * 3. get 不存在的 key → null；delete 后 get → null
 */

// chrome stub（download-manager 等模块经 directory-handle 间接引用时需要）
vi.stubGlobal('chrome', {
  runtime: { sendMessage: vi.fn(() => Promise.resolve({})) },
})

const { idbGet, idbPut, idbDelete } = await import('../utils/idb')
const { saveDirectoryHandle, getDirectoryHandle, removeDirectoryHandle } = await import(
  '../utils/directory-handle'
)

describe('utils/idb', () => {
  it('全新数据库：store 自动创建，put/get 往返', async () => {
    await idbPut('test-db-a', 'items', 'k1', { name: '视频', size: 42 })

    const value = await idbGet<{ name: string; size: number }>('test-db-a', 'items', 'k1')
    expect(value).toEqual({ name: '视频', size: 42 })
  })

  it('已存在但缺目标 store 的旧库：升版本重开并补建 store', async () => {
    // 先用原生 API 建一个只有 other-store 的库（模拟旧版本遗留数据库）
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('test-db-b', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('other-store')) {
          req.result.createObjectStore('other-store')
        }
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })

    // 首次访问 items store → 触发升版本补建路径
    await idbPut('test-db-b', 'items', 'k1', 'hello')
    const value = await idbGet<string>('test-db-b', 'items', 'k1')
    expect(value).toBe('hello')

    // 原有 store 不受影响
    await idbPut('test-db-b', 'other-store', 'legacy', 'old')
    const legacy = await idbGet<string>('test-db-b', 'other-store', 'legacy')
    expect(legacy).toBe('old')
  })

  it('get 不存在的 key 返回 null；delete 后返回 null', async () => {
    expect(await idbGet('test-db-c', 'items', 'missing')).toBeNull()

    await idbPut('test-db-c', 'items', 'k1', 'v')
    await idbDelete('test-db-c', 'items', 'k1')
    expect(await idbGet('test-db-c', 'items', 'k1')).toBeNull()
  })

  it('ArrayBuffer（HLS 数据）可往返', async () => {
    const data = new Uint8Array([1, 2, 3, 0x47]).buffer
    await idbPut('test-db-d', 'pending-saves', 'save_1', data)

    const back = await idbGet<ArrayBuffer>('test-db-d', 'pending-saves', 'save_1')
    expect(new Uint8Array(back!)).toEqual(new Uint8Array([1, 2, 3, 0x47]))
  })
})

describe('directory-handle（经 utils/idb 收敛后）', () => {
  it('目录句柄 save/get/remove 往返', async () => {
    const fakeHandle = { name: 'Downloads', kind: 'directory' } as unknown as FileSystemDirectoryHandle

    const name = await saveDirectoryHandle('download-directory', fakeHandle)
    expect(name).toBe('Downloads')

    const restored = await getDirectoryHandle('download-directory')
    expect(restored).toEqual(fakeHandle)

    await removeDirectoryHandle('download-directory')
    expect(await getDirectoryHandle('download-directory')).toBeNull()
  })
})
