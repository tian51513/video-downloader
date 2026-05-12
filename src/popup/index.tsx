import React, { useEffect, useState, useCallback } from 'react'
import { ConfigProvider, theme, Typography, Space, Button } from 'antd'
import { SettingOutlined, AppstoreOutlined } from '@ant-design/icons'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { VideoList } from './components/VideoList'
import type { DetectedVideo, ExtensionMessage } from '../types'

const { Title, Text } = Typography

function IndexPopup() {
  const { filteredVideos, isDetecting, setVideos } = useVideoStore()
  const { settings, loadSettings } = useSettingsStore()
  const [currentTab, setCurrentTab] = useState('')

  useEffect(() => { loadSettings() }, [loadSettings])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setCurrentTab(tabs[0].url)
        chrome.runtime.sendMessage(
          { type: 'GET_VIDEOS', payload: { pageUrl: tabs[0].url } },
          (response) => {
            if (response?.videos) setVideos(response.videos)
          }
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

  const handlePreview = useCallback((video: DetectedVideo) => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(
        `tabs/preview.html?url=${encodeURIComponent(video.url)}&format=${video.format}&title=${encodeURIComponent(video.title)}`
      ),
    })
  }, [])

  const handleDownload = useCallback(async (video: DetectedVideo) => {
    chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      payload: { video, downloader: settings.defaultDownloader },
    })
  }, [settings.defaultDownloader])

  const handleDownloadAll = useCallback(async () => {
    for (const video of filteredVideos) {
      chrome.runtime.sendMessage({
        type: 'START_DOWNLOAD',
        payload: { video, downloader: settings.defaultDownloader },
      })
    }
  }, [filteredVideos, settings.defaultDownloader])

  const handleOpenSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }, [])

  const isDark = settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: settings.accentColor },
      }}
    >
      <div style={{ width: settings.popupWidth, minHeight: 200, maxHeight: 500, display: 'flex', flexDirection: 'column', background: isDark ? '#141414' : '#fff' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>视频下载器</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {currentTab ? new URL(currentTab).hostname : ''}
              {filteredVideos.length > 0 && ` · ${filteredVideos.length} 个视频`}
            </Text>
          </div>
          <Space>
            <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={handleOpenSidePanel} title="打开详细面板" />
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => chrome.runtime.openOptionsPage()} title="设置" />
          </Space>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <VideoList
            videos={filteredVideos}
            isDetecting={isDetecting}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onDownloadAll={handleDownloadAll}
          />
        </div>
      </div>
    </ConfigProvider>
  )
}

export default IndexPopup
