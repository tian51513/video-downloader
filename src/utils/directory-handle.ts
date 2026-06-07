/**
 * 目录句柄管理
 * 使用 File System Access API 获取 FileSystemDirectoryHandle，
 * 存储到 IndexedDB 中，供 background service worker 下载时直接写入文件。
 */

const DB_NAME = 'video-downloader'
const STORE_NAME = 'handles'
const DOWNLOAD_DIR_KEY = 'download-directory'
const CACHE_DIR_KEY = 'cache-directory'

export interface DirectoryHandleInfo {
  name: string
  key: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close()
        const req2 = indexedDB.open(DB_NAME, db.version + 1)
        req2.onupgradeneeded = () => { req2.result.createObjectStore(STORE_NAME) }
        req2.onsuccess = () => resolve(req2.result)
        req2.onerror = () => reject(req2.error)
        return
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function saveDirectoryHandle(
  key: string,
  handle: FileSystemDirectoryHandle
): Promise<string> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, key)
    tx.oncomplete = () => resolve(handle.name)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getDirectoryHandle(
  key: string
): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

export async function removeDirectoryHandle(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getDirectoryInfo(
  key: string
): Promise<DirectoryHandleInfo | null> {
  try {
    const handle = await getDirectoryHandle(key)
    if (!handle) return null
    // 验证句柄仍然有效：请求权限
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') return { name: handle.name, key }
    // 尝试重新请求权限
    const newPerm = await handle.requestPermission({ mode: 'readwrite' })
    if (newPerm === 'granted') return { name: handle.name, key }
    return null
  } catch {
    return null
  }
}

export const DOWNLOAD_DIR = DOWNLOAD_DIR_KEY
export const CACHE_DIR = CACHE_DIR_KEY
