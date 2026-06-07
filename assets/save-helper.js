/**
 * 保存辅助页面
 * 核心用途：通过扩展页面的 host_permissions fetch 视频 URL，
 * 将数据加载到内存后，用 <a download> 或 File System Access API 保存。
 *
 * 这样文件名完全由我们控制，不受服务器 Content-Disposition 影响。
 *
 * s=1 时另存为（用户点击按钮 → showSaveFilePicker 原生对话框）。
 * s=0 时自动保存（<a download> 触发下载，文件名由 download 属性控制）。
 *
 * 两种数据来源：
 * 1. 从 IndexedDB 读取预缓存数据（k 参数）
 * 2. 直接 fetch 视频 URL（u 参数）— 扩展页面有 host_permissions
 */
(function () {
  'use strict'

  var DB_NAME = 'vd-pending-saves'
  var STORE_NAME = 'pending-saves'
  var HANDLE_DB = 'video-downloader'
  var HANDLE_STORE = 'handles'
  var DOWNLOAD_DIR_KEY = 'download-directory'
  var fillEl = document.getElementById('fill')
  var fnameEl = document.getElementById('fname')
  var statusEl = document.getElementById('status')

  function updateProgress(loaded, total) {
    var pct = total > 0 ? Math.min((loaded / total) * 100, 99) : 0
    fillEl.style.width = pct + '%'
    if (total > 0) {
      var mb = (loaded / 1024 / 1024).toFixed(1)
      var totalMb = (total / 1024 / 1024).toFixed(1)
      statusEl.textContent = mb + ' MB / ' + totalMb + ' MB'
    } else {
      statusEl.textContent = (loaded / 1024 / 1024).toFixed(1) + ' MB 已下载'
    }
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME)
      req.onupgradeneeded = function () {
        var db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = function () {
        var db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close()
          var req2 = indexedDB.open(DB_NAME, db.version + 1)
          req2.onupgradeneeded = function () { req2.result.createObjectStore(STORE_NAME) }
          req2.onsuccess = function () { resolve(req2.result) }
          req2.onerror = function () { reject(req2.error) }
          return
        }
        resolve(db)
      }
      req.onerror = function () { reject(req.error) }
    })
  }

  function readData(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite')
        var getReq = tx.objectStore(STORE_NAME).get(key)
        getReq.onsuccess = function () {
          tx.objectStore(STORE_NAME).delete(key)
          resolve(getReq.result)
        }
        getReq.onerror = function () { reject(getReq.error) }
      })
    })
  }

  // 读取用户在设置页选择的下载目录句柄（用于 showSaveFilePicker 的 startIn）
  function getDownloadDirHandle() {
    return new Promise(function (resolve) {
      var req = indexedDB.open(HANDLE_DB)
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(HANDLE_STORE)) {
          req.result.createObjectStore(HANDLE_STORE)
        }
      }
      req.onsuccess = function () {
        var db = req.result
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          resolve(null)
          return
        }
        var tx = db.transaction(HANDLE_STORE, 'readonly')
        var getReq = tx.objectStore(HANDLE_STORE).get(DOWNLOAD_DIR_KEY)
        getReq.onsuccess = function () { resolve(getReq.result || null) }
        getReq.onerror = function () { resolve(null) }
      }
      req.onerror = function () { resolve(null) }
    })
  }

  // 直接 fetch 视频 URL（扩展页面有 host_permissions，不受 CORS 限制）
  async function fetchVideoUrl(videoUrl, referrer, taskId) {
    console.log('[SaveHelper] fetch 开始:', videoUrl, 'referrer:', referrer)

    var response = await fetch(videoUrl, { referrer: referrer || '' })
    if (!response.ok) throw new Error('HTTP ' + response.status)

    var contentLength = response.headers.get('content-length')
    var total = contentLength ? parseInt(contentLength, 10) : 0
    var reader = response.body.getReader()
    var chunks = []
    var loaded = 0

    while (true) {
      var result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
      loaded += result.value.byteLength

      updateProgress(loaded, total)

      // 上报进度到 background
      try {
        chrome.runtime.sendMessage({
          type: 'SAVE_HELPER_PROGRESS',
          payload: { taskId: taskId, loaded: loaded, total: total, speed: 0 }
        }).catch(function () {})
      } catch (ex) { /* ignore */ }
    }

    // 合并 chunks
    var data = new Uint8Array(loaded)
    var off = 0
    for (var i = 0; i < chunks.length; i++) {
      data.set(chunks[i], off)
      off += chunks[i].byteLength
    }
    return data.buffer
  }

  // 自动保存：使用 chrome.downloads.download() API
  // save-helper 是完整扩展页面，有 downloads 权限，不受后台标签页限制
  // 降级：如果 chrome.downloads 不可用，回退到 <a download>
  function downloadViaAnchor(data, filename, mimeType, taskId) {
    var file = new File([data], filename, { type: mimeType })
    var blobUrl = URL.createObjectURL(file)

    // 优先使用 chrome.downloads API（可靠，不受后台标签页限制）
    if (chrome.downloads && chrome.downloads.download) {
      try {
        chrome.downloads.download(
          { url: blobUrl, filename: filename, saveAs: false, conflictAction: 'uniquify' },
          function (downloadId) {
            setTimeout(function () { URL.revokeObjectURL(blobUrl) }, 60000)

            if (chrome.runtime.lastError || !downloadId) {
              console.error('[SaveHelper] chrome.downloads.download 失败:', chrome.runtime.lastError?.message)
              URL.revokeObjectURL(blobUrl)
              // 降级到 <a download>
              fallbackAnchorDownload(blobUrl, filename, data, taskId)
              return
            }
            console.log('[SaveHelper] chrome.downloads 下载成功 ID:', downloadId, 'filename:', filename)
            if (taskId) {
              chrome.runtime.sendMessage({
                type: 'SAVE_HELPER_DONE',
                payload: { success: true, size: data.byteLength, taskId: taskId, chromeDownloadId: downloadId }
              }).catch(function () {})
            }
          }
        )
        return
      } catch (e) {
        console.warn('[SaveHelper] chrome.downloads 不可用，降级到 <a download>:', e.message)
      }
    }

    // 降级：<a download>（需要标签页激活，可能在后台标签页被静默忽略）
    fallbackAnchorDownload(blobUrl, filename, data, taskId)
  }

  function fallbackAnchorDownload(blobUrl, filename, data, taskId) {
    var a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()

    console.log('[SaveHelper] <a download> 降级触发: filename=' + filename + ', size=' + data.byteLength)

    setTimeout(function () {
      if (taskId) {
        chrome.runtime.sendMessage({
          type: 'SAVE_HELPER_DONE',
          payload: { success: true, size: data.byteLength, taskId: taskId }
        }).catch(function () {})
      }
    }, 2000)

    setTimeout(function () {
      try { document.body.removeChild(a) } catch (ex) {}
      URL.revokeObjectURL(blobUrl)
    }, 30000)
  }

  // 另存为：File System Access API（需要用户点击按钮激活）
  async function downloadViaSaveAsPicker(data, filename, mimeType, taskId, dirHandle) {
    var opts = {
      suggestedName: filename,
      types: [{
        description: 'Video',
        accept: { 'video/*': ['.mp4', '.ts', '.mkv', '.webm', '.avi', '.flv'] }
      }]
    }
    // 如果有存储的目录句柄，用它作为起始目录
    if (dirHandle) {
      try {
        var perm = await dirHandle.queryPermission({ mode: 'readwrite' })
        if (perm !== 'granted') {
          perm = await dirHandle.requestPermission({ mode: 'readwrite' })
        }
        if (perm === 'granted') {
          opts.startIn = dirHandle
        }
      } catch (e) {
        console.warn('[SaveHelper] 目录句柄权限检查失败:', e.message)
      }
    }
    var handle = await window.showSaveFilePicker(opts)
    statusEl.textContent = '写入中...'
    var writable = await handle.createWritable()
    await writable.write(data)
    await writable.close()
    console.log('[SaveHelper] 已保存到:', handle.name)
    if (taskId) {
      chrome.runtime.sendMessage({
        type: 'SAVE_HELPER_DONE',
        payload: { success: true, size: data.byteLength, taskId: taskId }
      }).catch(function () {})
    }
    statusEl.textContent = '已保存: ' + handle.name
    setTimeout(function () { window.close() }, 1000)
  }

  // 另存为模式：显示保存按钮，用户点击后触发 showSaveFilePicker
  function showSaveButton(data, filename, mimeType, taskId, dirHandle) {
    var sizeStr = (data.byteLength / 1024 / 1024).toFixed(1)
    statusEl.textContent = '数据已就绪 (' + sizeStr + ' MB)'

    var container = document.querySelector('.container')
    var btn = document.createElement('button')
    btn.textContent = '保存文件: ' + filename
    btn.id = 'save-btn'
    btn.style.cssText = 'margin-top: 16px; padding: 10px 20px; font-size: 14px; cursor: pointer; background: #1677ff; color: white; border: none; border-radius: 6px;'
    btn.addEventListener('click', async function () {
      btn.disabled = true
      btn.textContent = '保存中...'
      btn.style.opacity = '0.6'
      btn.style.cursor = 'not-allowed'
      try {
        await downloadViaSaveAsPicker(data, filename, mimeType, taskId, dirHandle)
      } catch (err) {
        if (err.name === 'AbortError') {
          // 用户取消了保存对话框
          console.log('[SaveHelper] 用户取消了保存对话框')
          statusEl.textContent = '已取消保存'
          if (taskId) {
            chrome.runtime.sendMessage({
              type: 'SAVE_HELPER_DONE',
              payload: { success: false, error: '用户取消', taskId: taskId }
            }).catch(function () {})
          }
          setTimeout(function () { window.close() }, 1500)
        } else {
          fail(err, taskId)
        }
      }
    })
    container.appendChild(btn)
  }

  function fail(err, taskId) {
    console.error('[SaveHelper] 异常:', err)
    document.getElementById('status').className = 'error'
    document.getElementById('status').textContent = '下载失败: ' + (err.message || String(err))
    chrome.runtime.sendMessage({
      type: 'SAVE_HELPER_DONE',
      payload: { success: false, error: err.message || String(err), taskId: taskId || undefined }
    }).catch(function () {})
    setTimeout(function () { window.close() }, 5000)
  }

  async function main() {
    try {
      var params = new URLSearchParams(window.location.search)
      var filename = params.get('n') || 'video.mp4'
      var mimeType = params.get('m') || 'video/mp4'
      var askSave = params.get('s') === '1'
      var taskId = params.get('t') || ''
      var key = params.get('k')
      var videoUrl = params.get('u')
      var referrer = params.get('r') || ''

      // 更新页面显示
      fnameEl.textContent = filename
      console.log('[SaveHelper] filename:', filename, 'askSave:', askSave, 'taskId:', taskId, 'hasKey:', !!key, 'hasUrl:', !!videoUrl, 'referrer:', referrer)

      var data

      // 模式1: 从 IndexedDB 读取预缓存数据（HLS 下载场景）
      if (key && !videoUrl) {
        data = await readData(key)
        if (!data || data.byteLength === 0) { fail(new Error('empty data'), taskId); return }
        statusEl.textContent = '保存中...'
      }
      // 模式2: 直接 fetch 视频 URL（扩展页面有 host_permissions）
      else if (videoUrl) {
        statusEl.textContent = '下载中...'
        try {
          data = await fetchVideoUrl(videoUrl, referrer, taskId)
        } catch (fetchErr) {
          console.warn('[SaveHelper] fetch 失败:', fetchErr.message)
          // 如果有 IndexedDB key，尝试降级
          if (key) {
            statusEl.textContent = 'IndexedDB 降级...'
            data = await readData(key)
            if (!data || data.byteLength === 0) { fail(new Error('所有下载方式均失败'), taskId); return }
          } else {
            fail(fetchErr, taskId)
            return
          }
        }
      } else {
        fail(new Error('no key or url'), taskId)
        return
      }

      var fileSize = data.byteLength
      console.log('[SaveHelper] 数据大小:', fileSize, '文件名:', filename)

      // 优先尝试目录句柄直接写入（无论 askSave 设置）
      // save-helper 是可见页面，可以 requestPermission
      var dirHandle = await getDownloadDirHandle()
      if (dirHandle) {
        try {
          var perm = await dirHandle.queryPermission({ mode: 'readwrite' })
          if (perm !== 'granted') {
            perm = await dirHandle.requestPermission({ mode: 'readwrite' })
          }
          if (perm === 'granted') {
            console.log('[SaveHelper] 使用目录句柄直接写入:', dirHandle.name)
            var fileHandle = await dirHandle.getFileHandle(filename, { create: true })
            var writable = await fileHandle.createWritable()
            await writable.write(data)
            await writable.close()
            console.log('[SaveHelper] 文件已保存到:', dirHandle.name + '/' + filename)
            statusEl.textContent = '已保存: ' + filename
            if (taskId) {
              chrome.runtime.sendMessage({
                type: 'SAVE_HELPER_DONE',
                payload: { success: true, size: data.byteLength, taskId: taskId }
              }).catch(function () {})
            }
            setTimeout(function () { window.close() }, 1000)
            return
          }
        } catch (dirErr) {
          console.warn('[SaveHelper] 目录句柄写入失败:', dirErr.message)
        }
      }

      // 目录句柄不可用，根据 askSaveLocation 设置决定保存方式
      if (askSave) {
        // 另存为：读取目录句柄作为 startIn（如果有的话）
        console.log('[SaveHelper] 目录句柄:', dirHandle ? dirHandle.name : '未设置')
        try {
          await downloadViaSaveAsPicker(data, filename, mimeType, taskId, dirHandle)
        } catch (err) {
          if (err.name === 'AbortError') {
            console.log('[SaveHelper] 用户取消了保存对话框')
            statusEl.textContent = '已取消保存'
            if (taskId) {
              chrome.runtime.sendMessage({
                type: 'SAVE_HELPER_DONE',
                payload: { success: false, error: '用户取消', taskId: taskId }
              }).catch(function () {})
            }
            setTimeout(function () { window.close() }, 1500)
          } else {
            // showSaveFilePicker 不可用时降级到按钮模式
            console.warn('[SaveHelper] showSaveFilePicker 不可用，降级到按钮模式:', err.message)
            showSaveButton(data, filename, mimeType, taskId, dirHandle)
          }
        }
      } else {
        // 自动保存：chrome.downloads API
        downloadViaAnchor(data, filename, mimeType, taskId)
        setTimeout(function () { window.close() }, 5000)
      }
    } catch (error) {
      fail(error)
    }
  }

  main()
})()
