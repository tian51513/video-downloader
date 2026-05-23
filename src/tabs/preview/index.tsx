import React, { useEffect, useState } from 'react'
import { ConfigProvider, theme, Spin } from 'antd'
import { FullPlayer } from './components/FullPlayer'
import type { DetectedVideo } from '../../types'

const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'opus'])

function PreviewPage() {
  const [video, setVideo] = useState<DetectedVideo | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const url = params.get('url')
    const format = params.get('format') || 'mp4'
    const title = params.get('title') || ''

    if (url) {
      setVideo({
        id: `preview_${Date.now()}`,
        url,
        title: decodeURIComponent(title),
        format: format as DetectedVideo['format'],
        mimeType: '',
        mediaType: AUDIO_FORMATS.has(format) ? 'audio' : 'video',
        source: 'network',
        pageUrl: '',
        domain: '',
        detectedAt: Date.now(),
      })
    }
  }, [])

  if (!video) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  const handleDownload = () => {
    chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', payload: { video, downloader: 'chrome' } })
  }

  const handleBack = () => { window.history.back() }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <FullPlayer video={video} onDownload={handleDownload} onBack={handleBack} />
    </ConfigProvider>
  )
}

export default PreviewPage