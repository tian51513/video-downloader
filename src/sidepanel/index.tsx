import React, { useEffect, useState, useCallback } from 'react'
import { ConfigProvider, theme, Typography, Checkbox, Empty } from 'antd'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { VideoItem } from '../popup/components/VideoItem'
import { FilterPanel } from './components/FilterPanel'
import { PreviewPlayer } from './components/PreviewPlayer'
import { BatchActions } from './components/BatchActions'
import type { DetectedVideo, ExtensionMessage, VideoFilter, DownloaderType } from '../types'

const { Title, Text } = Typography

function IndexSidePanel() {
  const { filteredVideos, currentFilter, setVideos, setFilter, clearVideos } = useVideoStore()
  const { settings, loadSettings } = useSettingsStore()
  const [currentTab, setCurrentTab] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null)
  const [downloader, setDownloader] = useState<DownloaderType>('chrome')

  useEffect(() => { loadSettings() }, [loadSettings])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setCurrentTab(tabs[0].url)
        chrome.runtime.sendMessage(
          { type: 'GET_VIDEOS', payload: { pageUrl: tabs[0].url } },
          (response) => { if (response?.videos) setVideos(response.videos) }
        )
      }
    })
  }, [setVideos])

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'VIDEO_DETECTED' && message.payload?.pageUrl === currentTab) {
        setVideos(message.payload.videos)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [currentTab, setVideos])

  const handleFilterChange = useCallback((filter: Partial<VideoFilter>) => setFilter(filter), [setFilter])
  const handleResetFilter = useCallback(() => {
    setFilter({ formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash'], minResolution: 'any', minSize: 'any', minDuration: 'any', sources: [], videoType: 'all', sortBy: 'detectedAt', sortOrder: 'desc' })
  }, [setFilter])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const handleDownload = useCallback(async (video: DetectedVideo) => {
    chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', payload: { video, downloader } })
  }, [downloader])

  const handleDownloadSelected = useCallback(async () => {
    for (const video of filteredVideos) { if (selectedIds.has(video.id)) handleDownload(video) }
  }, [filteredVideos, selectedIds, handleDownload])

  const handleDownloadAll = useCallback(async () => {
    for (const video of filteredVideos) handleDownload(video)
  }, [filteredVideos, handleDownload])

  const availableSources = [...new Set(filteredVideos.map((v) => v.domain))]
  const isDark = settings.themeMode === 'dark' || (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  if (previewVideo) {
    return (
      <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
        <PreviewPlayer video={previewVideo} onClose={() => setPreviewVideo(null)} />
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: settings.accentColor } }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: isDark ? '#141414' : '#fff' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}` }}>
          <Title level={5} style={{ margin: 0 }}>视频下载器</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {currentTab ? new URL(currentTab).hostname : ''} · {filteredVideos.length} 个视频
          </Text>
        </div>
        <FilterPanel filter={currentFilter} availableSources={availableSources} onFilterChange={handleFilterChange} onReset={handleResetFilter} />
        <BatchActions
          selectedCount={selectedIds.size} totalCount={filteredVideos.length}
          onDownloadSelected={handleDownloadSelected} onDownloadAll={handleDownloadAll}
          onClear={() => clearVideos()} downloader={downloader} onDownloaderChange={setDownloader}
        />
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredVideos.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Text type="secondary">未检测到视频</Text></div>
          ) : (
            filteredVideos.map((video) => (
              <div key={video.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}` }}>
                <Checkbox checked={selectedIds.has(video.id)} onChange={() => toggleSelect(video.id)} style={{ marginRight: 8 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <VideoItem video={video} onPreview={setPreviewVideo} onDownload={handleDownload} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ConfigProvider>
  )
}

export default IndexSidePanel
