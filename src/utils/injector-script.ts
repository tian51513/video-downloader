/**
 * MAIN world 注入脚本
 * 导出一个自包含函数，供 chrome.scripting.executeScript({ world: 'MAIN' }) 使用。
 * 不能使用任何 import/export，不能依赖外部变量。
 */

export function injectorMain(): void {
  'use strict'

  const WIN = window as any
  if (WIN.__VIDEO_DOWNLOADER_INJECTED__) return
  WIN.__VIDEO_DOWNLOADER_INJECTED__ = true

  // ===== 格式映射 =====
  const VIDEO_EXTENSIONS: Record<string, string> = {
    '.mp4': 'mp4', '.mkv': 'mkv', '.flv': 'flv', '.avi': 'avi',
    '.rmvb': 'rmvb', '.rm': 'rm', '.webm': 'webm', '.mov': 'mov', '.ts': 'ts'
  }
  const AUDIO_EXTENSIONS: Record<string, string> = {
    '.mp3': 'mp3', '.m4a': 'm4a', '.aac': 'aac', '.flac': 'flac',
    '.ogg': 'ogg', '.oga': 'ogg', '.wav': 'wav', '.wma': 'wma', '.opus': 'opus'
  }
  const HLS_CONTENT_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl']
  const DASH_CONTENT_TYPES = ['application/dash+xml', 'application/xml']
  const AUDIO_CONTENT_TYPES: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/x-mpeg': 'mp3',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
    'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/x-ms-wma': 'wma',
    'audio/wma': 'wma', 'audio/opus': 'opus', 'audio/webm': 'opus',
  }
  const AUDIO_FORMATS_SET: Record<string, boolean> = {
    'mp3': true, 'm4a': true, 'aac': true, 'flac': true,
    'ogg': true, 'wav': true, 'wma': true, 'opus': true,
  }
  function isAudioFormat(format: string): boolean {
    return !!AUDIO_FORMATS_SET[format]
  }

  // ===== m3u8 内联解析（MAIN world 不可 import） =====

  function parseAttributes(attrString: string): Record<string, string> {
    const result: Record<string, string> = {}
    const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(attrString)) !== null) {
      result[match[1]] = match[2] !== undefined ? match[2] : match[3]
    }
    return result
  }

  function resolveUrl(relative: string, base: string): string {
    try { return new URL(relative, base).href } catch { return relative }
  }

  function isM3u8Master(content: string): boolean {
    return content.includes('#EXT-X-STREAM-INF')
  }

  function parseM3u8Master(content: string, baseUrl: string): Array<{ bandwidth: number; width: number; height: number; url: string }> {
    const lines = content.split(/\r?\n/).map(function (l) { return l.trim() })
    const variants: Array<{ bandwidth: number; width: number; height: number; url: string }> = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue
      const attrs = parseAttributes(line.substring(17))
      const bandwidth = parseInt(attrs['BANDWIDTH'] || '0', 10)
      let width = 0, height = 0
      if (attrs['RESOLUTION']) {
        const parts = attrs['RESOLUTION'].split('x')
        width = parseInt(parts[0], 10) || 0
        height = parseInt(parts[1], 10) || 0
      }
      const nextLine = lines[i + 1]
      if (!nextLine || nextLine.startsWith('#')) continue
      variants.push({ bandwidth: bandwidth, width: width, height: height, url: resolveUrl(nextLine, baseUrl) })
    }
    return variants
  }

  function parseM3u8MediaDuration(content: string): number {
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-TARGETDURATION:')) {
        return parseInt(lines[i].substring(22), 10) || 0
      }
    }
    return 0
  }

  function estimateFileSize(bitrate: number, durationSeconds: number): number {
    return Math.round(bitrate * durationSeconds / 8)
  }

  /**
   * 解析 m3u8 内容并报告视频。
   * - master playlist: 报告每个变体（带 width/height/bitrate/预估 size）
   * - media playlist: 报告单个视频（带 duration）
   */
  function reportHlsFromContent(url: string, content: string, contentType: string): void {
    // 在 iframe 中运行时，使用父页面 URL 作为 pageUrl，以便后台正确获取页面标题
    const iframeCtx = getIframeParentContext()
    const isInIframe = !!iframeCtx
    const effectivePageUrl = iframeCtx ? iframeCtx.pageUrl : window.location.href
    const effectiveDomain = iframeCtx ? iframeCtx.domain : window.location.hostname

    if (isM3u8Master(content)) {
      // master playlist: 标记自身 URL 不报告，只报告变体
      reportedUrls[url] = true
      const variants = parseM3u8Master(content, url)
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i]
        if (reportedUrls[v.url]) continue
        reportedUrls[v.url] = true
        const video: any = {
          id: simpleId(v.url + '|hls'),
          url: v.url,
          title: isInIframe ? '' : detectVideoName(),
          format: 'hls',
          mimeType: contentType || '',
          mediaType: 'video',
          source: 'network',
          pageUrl: effectivePageUrl,
          domain: effectiveDomain,
          detectedAt: Date.now(),
        }
        if (v.width) video.width = v.width
        if (v.height) video.height = v.height
        if (v.bandwidth) video.bitrate = v.bandwidth
        sendToIsolated(video)

        // 异步获取子 media playlist 以估算文件大小
        if (v.bandwidth && v.bandwidth > 0) {
          ;(function (variantUrl, variantBandwidth, variantId) {
            var xhr = new XMLHttpRequest()
            xhr.open('GET', variantUrl, true)
            xhr.responseType = 'text'
            xhr.onload = function () {
              if (xhr.status >= 200 && xhr.status < 400) {
                var dur = 0
                var infLines = xhr.responseText.match(/#EXTINF:\s*([\d.]+)/g)
                if (infLines) {
                  for (var j = 0; j < infLines.length; j++) {
                    var m = infLines[j].match(/[\d.]+/)
                    if (m) dur += parseFloat(m[0])
                  }
                }
                if (dur > 0) {
                  var estSize = estimateFileSize(variantBandwidth, dur)
                  if (estSize > 0) {
                    // 通过 sendToIsolated 更新已有视频的 size 和 duration
                    sendToIsolated({
                      id: variantId,
                      url: variantUrl,
                      size: estSize,
                      duration: dur,
                    })
                  }
                }
              }
            }
            xhr.send()
          })(v.url, v.bandwidth, simpleId(v.url + '|hls'))
        }
      }
    } else {
      // media playlist: 提取 targetDuration 作为预估时长
      const targetDuration = parseM3u8MediaDuration(content)
      // 尝试累加 #EXTINF 获取更准确的时长
      let totalDuration = 0
      const infLines = content.match(/#EXTINF:\s*([\d.]+)/g)
      if (infLines) {
        for (let i = 0; i < infLines.length; i++) {
          const m = infLines[i].match(/[\d.]+/)
          if (m) totalDuration += parseFloat(m[0])
        }
      }
      const duration = totalDuration > 0 ? totalDuration : (targetDuration > 0 ? targetDuration : undefined)
      // 在 iframe 中时，手动构建带 pageUrl 的报告
      if (isInIframe) {
        if (reportedUrls[url]) return
        reportedUrls[url] = true
        if (url.length < 10) return
        const video: any = {
          id: simpleId(url + '|hls'),
          url,
          title: '',
          format: 'hls',
          mimeType: contentType || '',
          mediaType: 'video',
          source: 'network',
          pageUrl: effectivePageUrl,
          domain: effectiveDomain,
          detectedAt: Date.now()
        }
        if (duration) video.duration = duration
        sendToIsolated(video)
      } else {
        reportVideoWithMeta(url, 'hls', contentType, 'network', undefined, undefined, duration)
      }
    }
  }

  // ===== xHamster CDN multi-quality URL 解析 =====
  // URL 示例: ...media=hls4/multi=256x144:144p:,426x240:240p:,.../024/134/042/144p.av1.mp4.m3u8
  // 路径中 multi= 参数编码了所有可用画质，从中提取并上报每个画质变体
  function checkAndReportMultiQuality(url: string, contentType: string): boolean {
    var multiIdx = url.indexOf('multi=')
    if (multiIdx < 0) return false

    var multiStart = multiIdx + 6
    var multiEnd = url.indexOf('/', multiStart)
    if (multiEnd < 0) return false
    var multiStr = url.substring(multiStart, multiEnd)

    // 解析: "256x144:144p:,426x240:240p:,854x480:480p:,1280x720:720p:,1920x1080:1080p:"
    var parts = multiStr.split(',')
    var variants: Array<{ width: number; height: number; quality: string }> = []
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim()
      if (part.endsWith(':')) part = part.substring(0, part.length - 1)
      var colonIdx = part.indexOf(':')
      if (colonIdx < 0) continue
      var resStr = part.substring(0, colonIdx)
      var quality = part.substring(colonIdx + 1)
      var xIdx = resStr.indexOf('x')
      if (xIdx < 0) continue
      var w = parseInt(resStr.substring(0, xIdx), 10) || 0
      var h = parseInt(resStr.substring(xIdx + 1), 10) || 0
      if (w > 0 && h > 0 && quality) {
        variants.push({ width: w, height: h, quality: quality })
      }
    }
    if (variants.length <= 1) return false

    // 从 URL 提取文件名模式: .../144p.av1.mp4.m3u8 → quality=144p, codec=av1, ext=.mp4.m3u8
    var lastSlash = url.lastIndexOf('/')
    if (lastSlash < 0) return false
    var baseUrl = url.substring(0, lastSlash + 1)
    var fileName = url.substring(lastSlash + 1)

    var firstDot = fileName.indexOf('.')
    if (firstDot < 0) return false
    var codec = fileName.substring(firstDot + 1, fileName.indexOf('.', firstDot + 1))
    var extension = fileName.substring(fileName.indexOf('.', firstDot + 1))
    if (!codec || !extension) return false

    var iframeCtx = getIframeParentContext()
    var effectivePageUrl = iframeCtx ? iframeCtx.pageUrl : window.location.href
    var effectiveDomain = iframeCtx ? iframeCtx.domain : window.location.hostname
    var title = iframeCtx ? '' : detectVideoName()

    for (var j = 0; j < variants.length; j++) {
      var v = variants[j]
      var variantUrl = baseUrl + v.quality + '.' + codec + extension
      if (reportedUrls[variantUrl]) continue
      reportedUrls[variantUrl] = true
      var video: any = {
        id: simpleId(variantUrl + '|hls'),
        url: variantUrl,
        title: title,
        format: 'hls',
        mimeType: contentType || '',
        mediaType: 'video',
        source: 'network',
        pageUrl: effectivePageUrl,
        domain: effectiveDomain,
        detectedAt: Date.now(),
        width: v.width,
        height: v.height,
      }
      sendToIsolated(video)
    }
    return true
  }

  // ===== 哈希生成 =====
  let _hashCounter = 0
  function simpleId(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36) + '_' + (_hashCounter++)
  }

  // ===== 格式检测 =====
  function detectFormatFromUrl(url: string): string | null {
    const lower = url.toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '')
    if (lower.includes('.m3u8')) return 'hls'
    if (lower.includes('.mpd')) return 'dash'
    for (const ext in VIDEO_EXTENSIONS) {
      if (lower.endsWith(ext)) return VIDEO_EXTENSIONS[ext]
    }
    for (const ext in AUDIO_EXTENSIONS) {
      if (lower.endsWith(ext)) return AUDIO_EXTENSIONS[ext]
    }
    return null
  }

  function detectFormatFromContentType(contentType: string): string | null {
    const lower = contentType.toLowerCase()
    for (let i = 0; i < HLS_CONTENT_TYPES.length; i++) {
      if (lower.includes(HLS_CONTENT_TYPES[i])) return 'hls'
    }
    for (let i = 0; i < DASH_CONTENT_TYPES.length; i++) {
      if (lower.includes(DASH_CONTENT_TYPES[i])) return 'dash'
    }
    // 音频 MIME 类型检测
    const semicolonIdx = lower.indexOf(';')
    const mimeBase = semicolonIdx >= 0 ? lower.substring(0, semicolonIdx) : lower
    if (AUDIO_CONTENT_TYPES[mimeBase]) return AUDIO_CONTENT_TYPES[mimeBase]
    return null
  }

  function isMediaRequest(url: string, contentType?: string): boolean {
    return detectFormatFromUrl(url) !== null ||
      (contentType ? detectFormatFromContentType(contentType) !== null : false)
  }

  // ===== 去重 =====
  const reportedUrls: Record<string, boolean> = {}

  // ===== 通信 =====
  function sendToIsolated(video: any): void {
    window.postMessage({
      type: 'VIDEO_DOWNLOADER_DETECT',
      payload: video
    }, '*')
  }

  // ===== 乱码检测 =====
  function isGarbled(text: string): boolean {
    if (!text || text.trim().length === 0) return true
    if (/^\d{4,}$/.test(text)) return true
    if (/^[0-9a-f]{16,}$/i.test(text)) return true
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim())) return true
    const encodedRatio = (text.match(/%[0-9a-f]{2}/gi) || []).length / text.length
    if (encodedRatio > 0.3) return true
    const garbledRatio = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length / text.length
    if (garbledRatio > 0.2) return true
    return false
  }

  function sanitizeName(raw: string): string {
    return raw.trim()
      // 解码 HTML 实体
      .replace(/&(\w+);/g, function (_m, entity) {
        var map: Record<string, string> = {
          quot: '"', apos: "'", lsquo: '\u2018', rsquo: '\u2019',
          ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014',
          amp: '&', lt: '<', gt: '>', nbsp: '\u00a0',
        }
        if (entity in map) return map[entity]
        if (entity[0] === '#') {
          var code = entity.charAt(1) === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
          if (!isNaN(code) && code > 0) return String.fromCodePoint(code)
        }
        return _m[0]
      })
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\.+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .substring(0, 200)
  }

  // ===== 清理站点标题（去除站名、SEO 标签后缀）=====
  function cleanSiteTitle(title: string): string {
    // 仅在有 " | " 分隔符时才视为站点标题模式（如 "title – tags | site"）
    var pipeIdx = title.lastIndexOf(' | ')
    if (pipeIdx > 0) {
      var before = title.substring(0, pipeIdx).trim()
      var dashIdx = before.lastIndexOf(' – ')
      if (dashIdx > 0) {
        var candidate = before.substring(0, dashIdx).trim()
        if (candidate.length > 3) return candidate
      }
      if (before.length > 3) return before
    }
    // 没有 " | " 模式时不动标题（og:title 通常已经是干净的）
    return title
  }

  // ===== 智能命名 =====
  function detectVideoName(): string {
    // 优先使用 og:title（通常是干净的内容标题，不含站点名/SEO标签）
    const og = document.querySelector('meta[property="og:title"]')
    const ogTitle = og?.getAttribute('content')?.trim() || ''
    if (ogTitle && !isGarbled(ogTitle)) return ogTitle

    const title = document.title ? document.title.trim() : ''
    if (title && !isGarbled(title)) return cleanSiteTitle(title)

    const h1 = document.querySelector('h1')
    const h1Text = h1 ? (h1.textContent || '').trim() : ''
    if (h1Text && !isGarbled(h1Text)) return h1Text

    const video = document.querySelector('video')
    if (video && video.parentElement) {
      const parent = video.parentElement
      const heading = parent.querySelector('h1, h2, h3, .title, .video-title, [class*="title"]')
      if (heading?.textContent?.trim()) {
        const nearbyText = heading.textContent.trim()
        if (!isGarbled(nearbyText)) return nearbyText
      }
      if (parent.getAttribute('title')?.trim()) {
        return parent.getAttribute('title')!.trim()
      }
      if (video.getAttribute('aria-label')?.trim()) {
        return video.getAttribute('aria-label')!.trim()
      }
    }

    const segments = window.location.pathname.split('/').filter((s: string) => s && s !== '.')
    if (segments.length > 0) {
      let last = segments[segments.length - 1].split('?')[0].split('#')[0]
      last = last.replace(/\.\w+$/, '')
      try { last = decodeURIComponent(last) } catch (e) { /* ignore */ }
      last = last.replace(/[-_]+/g, ' ')
      if (last && !isGarbled(last)) return last
    }

    const domain = window.location.hostname.replace('www.', '')
    const d = new Date()
    const timestamp = '' + d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0') +
      String(d.getSeconds()).padStart(2, '0')
    return sanitizeName(domain + '_' + timestamp)
  }

  // ===== 视频报告 =====
  function reportVideo(url: string, format: string, contentType: string, source: string): void {
    reportVideoWithMeta(url, format, contentType, source)
  }

  // iframe 环境检测：返回父页面 URL 和域名，非 iframe 返回 null
  function getIframeParentContext(): { pageUrl: string; domain: string } | null {
    if (window.self === window.top) return null
    if (!document.referrer) return null
    try {
      const refUrl = new URL(document.referrer)
      return { pageUrl: document.referrer, domain: refUrl.hostname }
    } catch { return null }
  }

  function reportVideoWithMeta(
    url: string, format: string, contentType: string, source: string,
    width?: number, height?: number, duration?: number, size?: number
  ): void {
    if (reportedUrls[url]) return
    reportedUrls[url] = true
    if (url.length < 10) return

    const iframeCtx = getIframeParentContext()
    const video: any = {
      id: simpleId(url + '|' + format),
      url,
      title: iframeCtx ? '' : detectVideoName(),
      format,
      mimeType: contentType || '',
      mediaType: isAudioFormat(format) ? 'audio' : 'video',
      source: source || 'network',
      pageUrl: iframeCtx ? iframeCtx.pageUrl : window.location.href,
      domain: iframeCtx ? iframeCtx.domain : window.location.hostname,
      detectedAt: Date.now()
    }

    if (width) video.width = width
    if (height) video.height = height
    if (duration) video.duration = duration
    if (size && size > 0) video.size = size

    sendToIsolated(video)
  }

  // ===== XHR Hook =====
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (this: any, method: string, url: any) {
    const urlStr = typeof url === 'string' ? url : url.toString()
    this.__vdUrl = urlStr
    this.__vdCT = ''
    return originalOpen.apply(this, arguments as any)
  }

  XMLHttpRequest.prototype.send = function (this: any) {
    const xhr = this
    const url = xhr.__vdUrl as string
    if (url && isMediaRequest(url)) {
      const format = detectFormatFromUrl(url)
      if (format === 'hls') {
        // xHamster CDN multi-quality: URL 路径中包含 multi= 参数编码所有画质
        if (checkAndReportMultiQuality(url, '')) {
          // 已上报所有画质变体，无需再解析 m3u8 内容
        } else {
        // HLS: 等 readyState 4 读取 responseText 解析 m3u8 内容
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 4) {
            const ct = xhr.getResponseHeader('content-type') || ''
            let isHls = false
            for (let i = 0; i < HLS_CONTENT_TYPES.length; i++) {
              if (ct.toLowerCase().includes(HLS_CONTENT_TYPES[i])) { isHls = true; break }
            }
            if (!isHls) {
              // content-type 不匹配但 URL 是 .m3u8，仍按 hls 报告
              reportVideoWithMeta(url, 'hls', ct, 'network')
              return
            }
            try {
              const text = xhr.responseText || ''
              if (text.length > 0) {
                reportHlsFromContent(url, text, ct)
              } else {
                reportVideoWithMeta(url, 'hls', ct, 'network')
              }
            } catch {
              reportVideoWithMeta(url, 'hls', ct, 'network')
            }
          }
        })
        } // end else (normal HLS)
      } else if (format) {
        // 非 HLS 格式: 保持原有 readyState 2 逻辑
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 2) {
            const ct = xhr.getResponseHeader('content-type') || ''
            const cl = xhr.getResponseHeader('content-length')
            const size = cl ? parseInt(cl, 10) : undefined
            reportVideoWithMeta(url, format, ct, 'network', undefined, undefined, undefined, size)
          }
        })
      }
    }
    return originalSend.apply(this, arguments as any)
  }

  // ===== Fetch Hook =====
  const originalFetch = window.fetch
  window.fetch = function (input: any, init?: any) {
    const url = typeof input === 'string' ? input :
      input instanceof URL ? input.toString() : (input.url || '')

    const promise = originalFetch.apply(this, arguments as any)

    if (url && isMediaRequest(url)) {
      const format = detectFormatFromUrl(url)
      if (format === 'hls') {
        // xHamster CDN multi-quality: URL 路径中包含 multi= 参数编码所有画质
        if (checkAndReportMultiQuality(url, '')) {
          // 已上报所有画质变体，无需再解析 m3u8 内容
        } else {
        // HLS: clone response 并读取 text 解析 m3u8
        promise.then(function (response: Response) {
          const ct = response.headers.get('content-type') || ''
          let isHls = false
          for (let i = 0; i < HLS_CONTENT_TYPES.length; i++) {
            if (ct.toLowerCase().includes(HLS_CONTENT_TYPES[i])) { isHls = true; break }
          }
          if (!isHls && !url.toLowerCase().includes('.m3u8')) return
          response.clone().text().then(function (text) {
            if (text.length > 0) {
              reportHlsFromContent(url, text, ct)
            } else {
              reportVideoWithMeta(url, 'hls', ct, 'network')
            }
          }).catch(function () {
            reportVideoWithMeta(url, 'hls', ct, 'network')
          })
        }).catch(function () { /* ignore */ })
        } // end else (normal HLS)
      } else if (format) {
        // 非 HLS: 保持原有逻辑
        promise.then(function (response: Response) {
          const ct = response.headers.get('content-type') || ''
          if (isMediaRequest(url, ct)) {
            const cl = response.headers.get('content-length')
            const size = cl ? parseInt(cl, 10) : undefined
            reportVideoWithMeta(url, format, ct, 'network', undefined, undefined, undefined, size)
          }
        }).catch(function () { /* ignore */ })
      }
    }

    return promise
  }

  // ===== Blob Hook =====
  const originalCreateObjectURL = URL.createObjectURL
  URL.createObjectURL = function (blob: any) {
    const blobUrl = originalCreateObjectURL.apply(URL, arguments as any)
    if (blob instanceof Blob && blob.type) {
      if (blob.type.startsWith('video/')) {
        reportVideoWithMeta(blobUrl, 'blob', blob.type, 'blob', undefined, undefined, undefined, blob.size)
      } else if (blob.type.startsWith('audio/')) {
        reportVideoWithMeta(blobUrl, 'blob', blob.type, 'blob', undefined, undefined, undefined, blob.size)
      }
    }
    return blobUrl
  }

  // 监听 video 元素获取分辨率后更新已上报的视频信息
  const reportedWithMeta = new WeakSet<HTMLVideoElement>()
  const origSetAttribute = Element.prototype.setAttribute
  const videoElements = document.querySelectorAll('video')
  for (let i = 0; i < videoElements.length; i++) {
    setupVideoMetaWatch(videoElements[i] as HTMLVideoElement)
  }

  function setupVideoMetaWatch(videoEl: HTMLVideoElement): void {
    if (reportedWithMeta.has(videoEl)) return
    reportedWithMeta.add(videoEl)

    function reportMeta() {
      const w = videoEl.videoWidth
      const h = videoEl.videoHeight
      const dur = videoEl.duration && isFinite(videoEl.duration) ? Math.round(videoEl.duration) : undefined
      if (w && h) {
        const src = videoEl.src || videoEl.currentSrc || videoEl.getAttribute('src') || ''
        // 尝试匹配所有已上报的 URL（可能 src 与检测 URL 不同）
        var matchedUrl = src && reportedUrls[src] ? src : ''
        if (!matchedUrl && src) {
          // 尝试匹配 source 子元素的 src
          var sources = videoEl.querySelectorAll('source')
          for (var s = 0; s < sources.length; s++) {
            var sSrc = sources[s].src || sources[s].getAttribute('src') || ''
            if (sSrc && reportedUrls[sSrc]) { matchedUrl = sSrc; break }
          }
        }
        if (matchedUrl) {
          sendToIsolated({
            id: simpleId(matchedUrl + '|' + detectFormatFromUrl(matchedUrl)),
            url: matchedUrl,
            title: detectVideoName(),
            width: w,
            height: h,
            duration: dur,
            pageUrl: window.location.href,
            domain: window.location.hostname,
          })
        } else if (src) {
          // 未匹配已上报 URL，仍上报元数据（会被 detector 作为新视频处理）
          sendToIsolated({
            id: simpleId(src + '|' + detectFormatFromUrl(src)),
            url: src,
            title: detectVideoName(),
            width: w,
            height: h,
            duration: dur,
            pageUrl: window.location.href,
            domain: window.location.hostname,
          })
        }
      }
    }

    // 如果元数据已加载（脚本注入时视频已播放），立即上报
    if (videoEl.readyState >= 1 && videoEl.videoWidth > 0) {
      reportMeta()
    }
    videoEl.addEventListener('loadedmetadata', reportMeta, { once: true })
  }

  // ===== DOM Observer =====
  const domReportedElements = new WeakSet<Element>()

  function analyzeMediaElement(element: Element): void {
    // 跳过缩略图预览：<video> 的直接父元素是 <a> 时，通常是推荐列表的 hover 预览
    if (element.parentElement?.tagName === 'A' && element.tagName === 'VIDEO') return

    // <source> 元素只检查 src，不检查 data-src
    // data-src 在 <source> 上几乎全是懒加载的缩略图预览（如推荐列表 hover preview）
    const isSource = element.tagName === 'SOURCE'
    const src = element.getAttribute('src') ||
      (isSource ? '' : element.getAttribute('data-src')) ||
      element.getAttribute('data-video-url') || ''
    if (!src) return

    const format = detectFormatFromUrl(src)
    if (!format) return

    let fullUrl: string
    try {
      fullUrl = new URL(src, window.location.href).href
    } catch (e) {
      fullUrl = src
    }

    // 如果这个 URL 已经报告过就跳过
    if (reportedUrls[fullUrl]) return
    domReportedElements.add(element)

    // 提取分辨率和时长
    let width: number | undefined, height: number | undefined, duration: number | undefined
    if (element.tagName === 'VIDEO') {
      const videoEl = element as HTMLVideoElement
      width = videoEl.videoWidth || videoEl.width || undefined
      height = videoEl.videoHeight || videoEl.height || undefined
      duration = videoEl.duration && isFinite(videoEl.duration) ? Math.round(videoEl.duration) : undefined
    } else if (element.tagName === 'AUDIO') {
      const audioEl = element as HTMLAudioElement
      duration = audioEl.duration && isFinite(audioEl.duration) ? Math.round(audioEl.duration) : undefined
    }

    reportVideoWithMeta(fullUrl, format, '', 'dom', width, height, duration)
  }

  function scanExistingElements(): void {
    const videos = document.querySelectorAll('video')
    const audios = document.querySelectorAll('audio')
    const sources = document.querySelectorAll('source')
    for (let i = 0; i < videos.length; i++) analyzeMediaElement(videos[i])
    for (let i = 0; i < audios.length; i++) analyzeMediaElement(audios[i])
    for (let i = 0; i < sources.length; i++) analyzeMediaElement(sources[i])
  }

  // ===== iframe 扫描 =====
  function scanIframes(): void {
    const iframes = document.querySelectorAll('iframe')
    for (let i = 0; i < iframes.length; i++) {
      const src = iframes[i].getAttribute('src')
      if (!src) continue
      // 检查 iframe src 本身是否是视频 URL
      const format = detectFormatFromUrl(src)
      if (format) {
        let fullUrl: string
        try { fullUrl = new URL(src, window.location.href).href } catch (_e) { fullUrl = src }
        reportVideo(fullUrl, format, '', 'iframe')
      }
      // 检查 iframe src 的查询参数中是否包含视频 URL
      try {
        const urlObj = new URL(src, window.location.href)
        urlObj.searchParams.forEach(function (value, _key) {
          if (value && isMediaRequest(value)) {
            const fmt = detectFormatFromUrl(value)
            if (fmt) {
              let fullUrl: string
              try { fullUrl = new URL(value, window.location.href).href } catch (_e) { fullUrl = value }
              reportVideo(fullUrl, fmt, '', 'iframe')
            }
          }
        })
      } catch (_e) { /* ignore invalid URL */ }
    }
  }

  // ===== 扫描页面 JS 变量中的视频 URL（多画质） =====
  function scanPageConfig(): void {
    try {
      // 需要跳过的属性名关键词（非视频源 URL）
      var skipKeyPatterns = ['reporting', 'event_', 'stats', 'tracking', 'preview_url', 'timeline_', 'embed', 'poster', 'thumb', 'screenshot']
      // 常见的视频配置变量名
      var configVars = ['flashvars', 'videoConfig', 'playerConfig', 'videoSettings']
      for (var i = 0; i < configVars.length; i++) {
        var config = (WIN as any)[configVars[i]]
        if (!config || typeof config !== 'object') continue
        var keys = Object.keys(config)
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j]
          // 跳过非视频源属性
          var skipKey = false
          for (var s = 0; s < skipKeyPatterns.length; s++) {
            if (key.toLowerCase().indexOf(skipKeyPatterns[s]) >= 0) { skipKey = true; break }
          }
          if (skipKey) continue
          // 只关注包含 video / alt / source / url / hd / quality 的属性
          var keyLower = key.toLowerCase()
          if (keyLower.indexOf('video') < 0 && keyLower.indexOf('alt') < 0 &&
              keyLower.indexOf('source') < 0 && keyLower.indexOf('url') < 0 &&
              keyLower.indexOf('hd') < 0 && keyLower.indexOf('quality') < 0) continue

          var val = config[key]
          if (typeof val !== 'string' || val.length < 20) continue
          if (reportedUrls[val]) continue
          var format = detectFormatFromUrl(val)
          if (!format) continue
          var fullUrl: string
          try { fullUrl = new URL(val, window.location.href).href } catch (_e) { fullUrl = val }
          if (reportedUrls[fullUrl]) continue
          // 去重：去掉查询参数后再比较（因为 DOM src 可能带 rnd 等动态参数）
          try {
            var dedupeUrl = new URL(fullUrl)
            dedupeUrl.search = ''
            var dedupeKey = dedupeUrl.toString().replace(/\/$/, '')
            var alreadyDetected = false
            for (var existingUrl in reportedUrls) {
              try {
                var existingParsed = new URL(existingUrl)
                existingParsed.search = ''
                if (existingParsed.toString().replace(/\/$/, '') === dedupeKey) {
                  alreadyDetected = true
                  break
                }
              } catch (_e2) { /* skip */ }
            }
            if (alreadyDetected) continue
          } catch (_e) { /* skip URL parse error */ }

          reportVideoWithMeta(fullUrl, format, '', 'config', undefined, undefined, undefined, undefined)
        }
      }
    } catch (_e) { /* ignore */ }
  }

  // 立即扫描已有元素
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      scanExistingElements()
      scanIframes()
      scanPageConfig()
    })
  } else {
    scanExistingElements()
    scanIframes()
    scanPageConfig()
  }

  // 监听新增元素
  const domObserver = new MutationObserver(function (mutations) {
    for (let m = 0; m < mutations.length; m++) {
      const mutation = mutations[m]
      // 处理属性变化（例如 src 被动态设置到已有的 video/audio/source 元素上）
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        const target = mutation.target
        if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO' || target.tagName === 'SOURCE') {
          analyzeMediaElement(target)
        }
        if (target.tagName === 'VIDEO') {
          setupVideoMetaWatch(target as HTMLVideoElement)
        }
        if (target.tagName === 'IFRAME') {
          scanIframes()
        }
      }

      for (let n = 0; n < mutation.addedNodes.length; n++) {
        const node = mutation.addedNodes[n]
        if (node instanceof HTMLElement) {
          if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO' || node.tagName === 'SOURCE') {
            analyzeMediaElement(node)
          }
          if (node.tagName === 'VIDEO') {
            setupVideoMetaWatch(node as HTMLVideoElement)
          }
          if (node.tagName === 'IFRAME') {
            scanIframes()
          }
          const childMedias = node.querySelectorAll('video, audio, source')
          for (let v = 0; v < childMedias.length; v++) {
            analyzeMediaElement(childMedias[v])
          }
          const childVideoEls = node.querySelectorAll('video')
          for (let v = 0; v < childVideoEls.length; v++) {
            setupVideoMetaWatch(childVideoEls[v] as HTMLVideoElement)
          }
        }
      }
    }
  })

  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'data-video-url'],
  })

  // ===== 响应 ISOLATED world 的 rescan 请求 =====
  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    if (event.data?.type === 'VIDEO_DOWNLOADER_RESCAN') {
      // 清除已上报 URL 记录，允许重新检测
      for (var key in reportedUrls) {
        delete reportedUrls[key]
      }
      // 重新扫描 DOM、iframe、页面配置
      scanExistingElements()
      scanIframes()
      scanPageConfig()
    }
  })

  // ===== 页面卸载清理 =====
  window.addEventListener('beforeunload', function () {
    domObserver.disconnect()
    URL.createObjectURL = originalCreateObjectURL
    XMLHttpRequest.prototype.open = originalOpen
    XMLHttpRequest.prototype.send = originalSend
    window.fetch = originalFetch
  })

  console.log('[VideoDownloader] MAIN world injector initialized')
}
