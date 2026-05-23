import React, { useEffect, useState, useCallback } from 'react'
import { ConfigProvider, theme, Typography, Space, Button, Badge, Dropdown, Modal, message } from 'antd'
import { SettingOutlined, AppstoreOutlined, DeleteOutlined, ClearOutlined, CloseCircleOutlined, HistoryOutlined } from '@ant-design/icons'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { useDownloadStore } from '../store/download-store'
import { VideoList } from './components/VideoList'
import type { DetectedVideo, ExtensionMessage, DownloadTask } from '../types'

const { Title, Text } = Typography

function IndexPopup() {
  const { filteredGroups, isDetecting, setVideos, clearVideos } = useVideoStore()
  const { settings, loadSettings } = useSettingsStore()
  const { tasks, addTask, clearCompleted, clearFailed, clearOrphanedTasks, clearPageTasks, removeTask } = useDownloadStore()
  const [currentTab, setCurrentTab] = useState('')

  useEffect(() => { loadSettings() }, [loadSettings])

  // 加载下载任务
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOADS' }, (response) => {
      if (response?.tasks) {
        for (const t of response.tasks) addTask(t)
      }
    })
  }, [addTask])

  // 加载所有标签页的视频（共享模式）
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setCurrentTab(tabs[0].url)
    })
    chrome.runtime.sendMessage({ type: 'GET_VIDEOS' }, (response) => {
      if (response?.videos) setVideos(response.videos)
    })
  }, [setVideos])

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'VIDEO_DETECTED' && message.payload?.videos) {
        const store = useVideoStore.getState()
        const pageUrl = message.payload.pageUrl
        const merged = [...store.videos.filter((v) => v.pageUrl !== pageUrl), ...message.payload.videos]
        store.setVideos(merged)
      } else if (message.type === 'DOWNLOAD_PROGRESS') {
        const task = message.payload as DownloadTask
        addTask(task)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [addTask])

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

  const handlePause = useCallback(async (taskId: string) => {
    chrome.runtime.sendMessage({ type: 'PAUSE_DOWNLOAD', payload: { taskId } })
  }, [])

  const handleCancel = useCallback(async (taskId: string) => {
    chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD', payload: { taskId } })
    removeTask(taskId)
  }, [removeTask])

  const handleRetry = useCallback(async (taskId: string) => {
    chrome.runtime.sendMessage({ type: 'RETRY_DOWNLOAD', payload: { taskId } })
  }, [])

  const handleDownloadAll = useCallback(async () => {
    for (const group of filteredGroups) {
      for (const video of group.versions) {
        chrome.runtime.sendMessage({
          type: 'START_DOWNLOAD',
          payload: { video, downloader: settings.defaultDownloader },
        })
      }
    }
  }, [filteredGroups, settings.defaultDownloader])

  const handleOpenSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }, [])

  // 清除操作
  const handleClearCurrentList = useCallback(() => {
    Modal.confirm({
      title: '确定清除当前页面的下载记录？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        clearPageTasks(currentTab)
        chrome.runtime.sendMessage({ type: 'CLEAR_PAGE_DOWNLOADS', payload: { pageUrl: currentTab } }).catch(() => {})
        message.success('已清除当前页面的下载记录')
      },
    })
  }, [currentTab, clearPageTasks])

  const handleClearCompleted = useCallback(() => {
    clearCompleted()
    chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_DOWNLOADS' }).catch(() => {})
    message.success('已清除完成记录')
  }, [clearCompleted])

  const handleClearFailed = useCallback(() => {
    clearFailed()
    chrome.runtime.sendMessage({ type: 'CLEAR_FAILED_DOWNLOADS' }).catch(() => {})
    message.success('已清除失败记录')
  }, [clearFailed])

  const handleClearOrphaned = useCallback(async () => {
    const tabs = await chrome.tabs.query({})
    const openUrls = tabs.map((t) => t.url || '').filter(Boolean)
    clearOrphanedTasks(openUrls)
    chrome.runtime.sendMessage({ type: 'CLEAR_ORPHANED_DOWNLOADS', payload: { openPageUrls: openUrls } }).catch(() => {})
    message.success('已清除已关闭页面的下载')
  }, [clearOrphanedTasks])

  const downloadingCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'merging').length

  const isDark = settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const handleClearAllVideos = useCallback(() => {
    Modal.confirm({
      title: '确定清除所有已检测的视频？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        clearVideos()
        chrome.runtime.sendMessage({ type: 'CLEAR_ALL_VIDEOS' }).catch(() => {})
        // 触发所有标签页重新检测视频
        chrome.runtime.sendMessage({ type: 'RESCAN_ALL_TABS' }).catch(() => {})
        message.success('已清除所有检测视频，正在重新检测...')
      },
    })
  }, [clearVideos])

  const clearMenuItems = [
    { key: 'all', icon: <DeleteOutlined />, label: '清除所有视频', onClick: handleClearAllVideos },
    { key: 'current', icon: <DeleteOutlined />, label: '清除当前页面下载', onClick: handleClearCurrentList },
    { key: 'completed', icon: <HistoryOutlined />, label: '清除已完成', onClick: handleClearCompleted },
    { key: 'failed', icon: <CloseCircleOutlined />, label: '清除失败', onClick: handleClearFailed },
    { key: 'orphaned', icon: <ClearOutlined />, label: '清除已关闭页面', onClick: handleClearOrphaned },
  ]

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: settings.accentColor },
      }}
    >
      <div style={{
        width: settings.popupWidth, minHeight: 200, maxHeight: 500,
        display: 'flex', flexDirection: 'column',
        background: isDark ? '#141414' : '#fff',
      }}>
        {/* 头部 */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid ' + (isDark ? '#303030' : '#f0f0f0'),
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>视频下载器</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filteredGroups.length > 0 ? `共 ${filteredGroups.length} 个` : ''}
            </Text>
          </div>
          <Space>
            {downloadingCount > 0 && (
              <Badge count={downloadingCount} size="small">
                <Button type="text" size="small" disabled />
              </Badge>
            )}
            <Dropdown menu={{ items: clearMenuItems }} trigger={['click']}>
              <Button type="text" size="small" icon={<DeleteOutlined />} title="清除" />
            </Dropdown>
            <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={handleOpenSidePanel} title="打开详细面板" />
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => chrome.runtime.openOptionsPage()} title="设置" />
          </Space>
        </div>

        {/* 视频列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <VideoList
            groups={filteredGroups}
            isDetecting={isDetecting}
            downloadTasks={tasks}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onPause={handlePause}
            onCancel={handleCancel}
            onRetry={handleRetry}
            onDownloadAll={handleDownloadAll}
            isDark={isDark}
          />
        </div>
      </div>
    </ConfigProvider>
  )
}

export default IndexPopup
