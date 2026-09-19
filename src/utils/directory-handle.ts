/**
 * 目录句柄管理
 * 使用 File System Access API 获取 FileSystemDirectoryHandle，
 * 存储到 IndexedDB 中，供 background service worker 下载时直接写入文件。
 */

import { idbGet, idbPut, idbDelete } from './idb'

const DB_NAME = 'video-downloader'
const STORE_NAME = 'handles'
const DOWNLOAD_DIR_KEY = 'download-directory'
const CACHE_DIR_KEY = 'cache-directory'

export interface DirectoryHandleInfo {
  name: string
  key: string
}

export async function saveDirectoryHandle(
  key: string,
  handle: FileSystemDirectoryHandle
): Promise<string> {
  await idbPut(DB_NAME, STORE_NAME, key, handle)
  return handle.name
}

export async function getDirectoryHandle(
  key: string
): Promise<FileSystemDirectoryHandle | null> {
  return idbGet<FileSystemDirectoryHandle>(DB_NAME, STORE_NAME, key)
}

export async function removeDirectoryHandle(key: string): Promise<void> {
  await idbDelete(DB_NAME, STORE_NAME, key)
}

export async function getDirectoryInfo(
  key: string
): Promise<DirectoryHandleInfo | null> {
  try {
    const handle = await getDirectoryHandle(key)
    if (!handle) return null
    // 验证句柄仍然有效：请求权限
    // TS lib.dom 尚未收录 FileSystemHandle 的 permission 方法（Chrome 已实现）
    const perm = await (handle as any).queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') return { name: handle.name, key }
    // 尝试重新请求权限
    const newPerm = await (handle as any).requestPermission({ mode: 'readwrite' })
    if (newPerm === 'granted') return { name: handle.name, key }
    return null
  } catch {
    return null
  }
}

export const DOWNLOAD_DIR = DOWNLOAD_DIR_KEY
export const CACHE_DIR = CACHE_DIR_KEY
