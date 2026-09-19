/**
 * IndexedDB 深模块（TS 侧统一入口）
 *
 * 收敛此前散落的 open/upgrade 样板（hls-downloader、directory-handle；
 * assets/ 下 save-helper.js、offscreen.js 两份纯 JS 副本受"不经编译"约束
 * 暂保留，待注入机制改造后一并收敛）。
 *
 * 两个已知陷阱在此统一处理（见 CLAUDE.md 关键注意事项）：
 * 1. onupgradeneeded 仅在版本变化时触发：打开已有库必须检查 store 是否
 *    存在，缺失则升版本重开并在升级回调里补建。
 * 2. new Promise executor 内的异步回调（onsuccess 等）抛出的异常不会被
 *    Promise 捕获，必须 try/catch。
 */

function openStoreDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(dbName)
    } catch (e) {
      reject(e)
      return
    }

    req.onupgradeneeded = () => {
      try {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName)
        }
      } catch (e) {
        reject(e)
      }
    }

    req.onsuccess = () => {
      try {
        const db = req.result
        if (db.objectStoreNames.contains(storeName)) {
          resolve(db)
          return
        }
        // 已存在的旧库缺 store：升版本重开，在 onupgradeneeded 里补建
        db.close()
        const req2 = indexedDB.open(dbName, db.version + 1)
        req2.onupgradeneeded = () => {
          try {
            req2.result.createObjectStore(storeName)
          } catch (e) {
            reject(e)
          }
        }
        req2.onsuccess = () => resolve(req2.result)
        req2.onerror = () => reject(req2.error)
        req2.onblocked = () =>
          reject(new Error(`IndexedDB ${dbName} 升级被阻塞（存在未关闭的旧连接）`))
      } catch (e) {
        reject(e)
      }
    }

    req.onerror = () => reject(req.error)
  })
}

/**
 * 在单个事务里执行一次 store 操作，事务完成时返回 request.result。
 * op 返回 IDBRequest（get/put/delete）；不需要结果的操作返回 void。
 */
function runInTx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<T> | undefined
    try {
      const tx = db.transaction(storeName, mode)
      const store = tx.objectStore(storeName)
      request = op(store) as IDBRequest<T> | undefined
      tx.oncomplete = () => resolve(request?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'))
    } catch (e) {
      reject(e)
    }
  })
}

/** 读取 key；不存在返回 null */
export async function idbGet<T = unknown>(
  dbName: string,
  storeName: string,
  key: IDBValidKey
): Promise<T | null> {
  const db = await openStoreDb(dbName, storeName)
  try {
    const value = await runInTx<T>(db, storeName, 'readonly', (s) => s.get(key))
    return (value ?? null) as T | null
  } finally {
    db.close()
  }
}

/** 写入 key/value */
export async function idbPut(
  dbName: string,
  storeName: string,
  key: IDBValidKey,
  value: unknown
): Promise<void> {
  const db = await openStoreDb(dbName, storeName)
  try {
    await runInTx(db, storeName, 'readwrite', (s) => s.put(value, key))
  } finally {
    db.close()
  }
}

/** 删除 key */
export async function idbDelete(
  dbName: string,
  storeName: string,
  key: IDBValidKey
): Promise<void> {
  const db = await openStoreDb(dbName, storeName)
  try {
    await runInTx(db, storeName, 'readwrite', (s) => s.delete(key))
  } finally {
    db.close()
  }
}
