/**
 * Offscreen document script
 * 在 Service Worker 无法使用 URL.createObjectURL 时，
 * 通过此文档创建和释放 Blob URL，并执行下载。
 *
 * 支持：
 * - OFFSCREEN_CREATE_BLOB_URL: 从已有 ArrayBuffer 创建 Blob URL
 * - OFFSCREEN_REVOKE_BLOB_URL: 释放 Blob URL
 * - OFFSCREEN_FETCH_AND_DOWNLOAD: fetch 视频 → File → blob URL → chrome.downloads
 *
 * 注意：new File([data], filename) 创建的 blob URL，Chrome 下载时使用 File 的 name 作为文件名。
 */
var OFFSCREEN_DB_NAME = 'vd-pending-saves'
var OFFSCREEN_STORE_NAME = 'pending-saves'

function openOffscreenDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(OFFSCREEN_DB_NAME)
    req.onupgradeneeded = function () {
      var db = req.result
      if (!db.objectStoreNames.contains(OFFSCREEN_STORE_NAME)) {
        db.createObjectStore(OFFSCREEN_STORE_NAME)
      }
    }
    req.onsuccess = function () {
      var db = req.result
      if (!db.objectStoreNames.contains(OFFSCREEN_STORE_NAME)) {
        db.close()
        var req2 = indexedDB.open(OFFSCREEN_DB_NAME, db.version + 1)
        req2.onupgradeneeded = function () { req2.result.createObjectStore(OFFSCREEN_STORE_NAME) }
        req2.onsuccess = function () { resolve(req2.result) }
        req2.onerror = function () { reject(req2.error) }
        return
      }
      resolve(db)
    }
    req.onerror = function () { reject(req.error) }
  })
}

function writeToOffscreenDB(key, data) {
  return openOffscreenDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(OFFSCREEN_STORE_NAME, 'readwrite')
        tx.objectStore(OFFSCREEN_STORE_NAME).put(data, key)
        tx.oncomplete = function () { db.close(); resolve() }
        tx.onerror = function () { db.close(); reject(tx.error) }
      } catch (e) {
        db.close()
        reject(e)
      }
    })
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_CREATE_BLOB_URL') {
    try {
      var blob = new Blob([message.payload.data], { type: message.payload.mimeType })
      var url = URL.createObjectURL(blob)
      sendResponse({ url: url })
    } catch (error) {
      sendResponse({ url: null, error: error.message })
    }
    return true
  }

  if (message.type === 'OFFSCREEN_REVOKE_BLOB_URL') {
    try {
      URL.revokeObjectURL(message.payload.url)
      sendResponse({ success: true })
    } catch (error) {
      sendResponse({ success: false, error: error.message })
    }
    return true
  }

  if (message.type === 'OFFSCREEN_FETCH_AND_DOWNLOAD') {
    var payload = message.payload
    var videoUrl = payload.url
    var referer = payload.referer || ''
    var mimeType = payload.mimeType || 'video/mp4'
    var taskId = payload.taskId || ''
    var filename = payload.filename || 'video.mp4'
    var saveAs = !!payload.saveAs

    console.log('[Offscreen] fetch+download 开始:', videoUrl, 'filename:', filename, 'saveAs:', saveAs)

    // 将 data 提升到外层作用域，以便 .catch() 也能访问
    var downloadedData = null

    fetch(videoUrl, {
      headers: { 'Referer': referer }
    })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status)

      var contentLength = response.headers.get('content-length')
      var total = contentLength ? parseInt(contentLength, 10) : 0
      var reader = response.body.getReader()
      var chunks = []
      var loaded = 0
      var lastReportTime = 0

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            // 合并所有 chunks
            var data = new Uint8Array(loaded)
            var off = 0
            for (var i = 0; i < chunks.length; i++) {
              data.set(chunks[i], off)
              off += chunks[i].byteLength
            }
            console.log('[Offscreen] fetch 完成, size:', data.byteLength)

            // 提升到外层作用域，供 catch 中的降级逻辑使用
            downloadedData = data

            // 使用 new File 而非 new Blob：Chrome 下载 blob URL 时使用 File 的 name 属性
            var file = new File([data], filename, { type: mimeType })
            var blobUrl = URL.createObjectURL(file)

            // chrome.downloads 在 offscreen document 中可能为 undefined（reasons: ['BLOBS'] 不授予 downloads API）
            // 必须用同步 try/catch，因为 TypeError 在调用时同步抛出，回调永远不会执行
            try {
              chrome.downloads.download(
                { url: blobUrl, filename: filename, saveAs: saveAs, conflictAction: 'uniquify' },
                function (downloadId) {
                  // 延迟释放 blob URL，确保下载完成
                  setTimeout(function () { URL.revokeObjectURL(blobUrl) }, 60000)

                  if (chrome.runtime.lastError || !downloadId) {
                    console.error('[Offscreen] chrome.downloads.download 失败:', chrome.runtime.lastError?.message)
                    URL.revokeObjectURL(blobUrl)
                    // 数据已下载但保存失败：写入 IndexedDB 作为降级，避免 Layer 2 重复下载
                    var fallbackKey = 'offscreen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
                    writeToOffscreenDB(fallbackKey, data)
                      .then(function () {
                        console.log('[Offscreen] 数据已写入 IndexedDB 降级: key=' + fallbackKey + ', size=' + data.byteLength)
                        sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'download failed', size: data.byteLength, fallbackKey: fallbackKey })
                      })
                      .catch(function (dbErr) {
                        console.error('[Offscreen] IndexedDB 写入失败:', dbErr.message)
                        sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'download failed', size: data.byteLength })
                      })
                    return
                  }
                  console.log('[Offscreen] 下载成功 ID:', downloadId, 'filename:', filename)
                  sendResponse({ success: true, downloadId: downloadId, size: data.byteLength })
                }
              )
            } catch (e) {
              // chrome.downloads 为 undefined（预期行为：reasons: ['BLOBS'] 不授予 downloads API）
              console.warn('[Offscreen] chrome.downloads 不可用，降级到 IndexedDB:', e.message)
              URL.revokeObjectURL(blobUrl)

              // 数据已下载但无法保存：写入 IndexedDB 作为降级
              var fallbackKey = 'offscreen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
              writeToOffscreenDB(fallbackKey, data)
                .then(function () {
                  console.log('[Offscreen] 数据已写入 IndexedDB 降级 (chrome.downloads 不可用): key=' + fallbackKey + ', size=' + data.byteLength)
                  sendResponse({ success: false, error: 'chrome.downloads unavailable: ' + e.message, size: data.byteLength, fallbackKey: fallbackKey })
                })
                .catch(function (dbErr) {
                  console.error('[Offscreen] IndexedDB 写入失败:', dbErr.message)
                  sendResponse({ success: false, error: 'chrome.downloads unavailable: ' + e.message, size: data.byteLength })
                })
            }
            return
          }

          chunks.push(result.value)
          loaded += result.value.byteLength

          // 上报进度（每 300ms 一次），使用 SAVE_HELPER_PROGRESS 类型
          var now = Date.now()
          if (now - lastReportTime >= 300) {
            lastReportTime = now
            try {
              chrome.runtime.sendMessage({
                type: 'SAVE_HELPER_PROGRESS',
                payload: { taskId: taskId, loaded: loaded, total: total, speed: 0 }
              }).catch(function () {})
            } catch (ex) { /* ignore */ }
          }

          return pump()
        })
      }

      return pump()
    })
    .catch(function (error) {
      console.error('[Offscreen] fetch 失败:', error.name, error.message)
      // 如果 fetch 阶段失败但数据已部分下载（不会发生，但防御性处理）
      sendResponse({ success: false, error: error.name + ': ' + error.message })
    })

    return true // 保持 sendResponse 通道开放
  }
})
