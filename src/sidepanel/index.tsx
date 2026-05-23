import React, { useEffect, useState, useCallback } from 'react'
import { ConfigProvider, theme, Typography, Badge, Space, Button, Dropdown, Modal, message } from 'antd'
import { SettingOutlined, DownloadOutlined, DeleteOutlined, ClearOutlined, CloseCircleOutlined, HistoryOutlined } from '@ant-design/icons'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { useDownloadStore } from '../store/download-store'
import { VideoGroupItem } from '../popup/components/VideoItem'
import { FilterPanel } from './components/FilterPanel'
import { BatchActions } from './components/BatchActions'
import { PreviewPlayer } from './components/PreviewPlayer'
import type { DetectedVideo, ExtensionMessage, VideoFilter, DownloaderType, DownloadTask } from '../types'
import { formatFileSize, formatSpeed, formatDuration } from '../utils/format'

const { Title, Text } = Typography

function IndexSidePanel() {
  const { filteredGroups, currentFilter, setVideos, setFilter, clearVideos, clearCurrentPageVideos } = useVideoStore()
  const { settings, loadSettings } = useSettingsStore()
  const { tasks, addTask, clearCompleted, clearFailed, clearOrphanedTasks, clearPageTasks, removeTask } = useDownloadStore()
  const [currentTab, setCurrentTab] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null)
  const [downloader, setDownloader] = useState<DownloaderType>('chrome')

  useEffect(() => { loadSettings() }, [loadSettings])

  // 加载下载任务
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOADS' }, (response) => {
      if (response?.tasks) {
        for (const t of response.tasks) addTask(t)
      }
    })
  }, [addTask])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setCurrentTab(tabs[0].url)
    })
    // 加载所有标签页的视频（共享模式）
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

  const handleFilterChange = useCallback((filter: Partial<VideoFilter>) => setFilter(filter), [setFilter])
  const handleResetFilter = useCallback(() => {
    setFilter({ formats: ['mp4', 'mkv', 'webm', 'flv', 'hls', 'dash', 'blob', 'ts', 'mp3', 'm4a', 'flac', 'ogg', 'wav'], minResolution: 'any', minSize: 'any', minDuration: 'any', sources: [], videoType: 'all', sortBy: 'detectedAt', sortOrder: 'desc' })
  }, [setFilter])

  const handlePreview = useCallback((video: DetectedVideo) => {
    setPreviewVideo(video)
  }, [])

  const handleDownload = useCallback(async (video: DetectedVideo) => {
    chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', payload: { video, downloader } })
  }, [downloader])

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

  const handleDownloadSelected = useCallback(async () => {
    for (const group of filteredGroups) {
      for (const video of group.versions) {
        if (selectedIds.has(video.id)) handleDownload(video)
      }
    }
  }, [filteredGroups, selectedIds, handleDownload])

  const handleDownloadAll = useCallback(async () => {
    for (const group of filteredGroups) {
      for (const video of group.versions) handleDownload(video)
    }
  }, [filteredGroups, handleDownload])

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

  const availableSources = [...new Set(filteredGroups.flatMap((g) => g.versions.map((v) => v.domain)))]
  const isDark = settings.themeMode === 'dark' || (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const downloadingCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'merging').length

  const handleClearAllVideos = useCallback(() => {
    Modal.confirm({
      title: '确定清除所有已检测的视频？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        clearVideos()
        chrome.runtime.sendMessage({ type: 'CLEAR_ALL_VIDEOS' }).catch(() => {})
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

  // 统计选中的视频数量（从所有 groups 中）
  const totalVideoCount = filteredGroups.reduce((sum, g) => sum + g.versions.length, 0)
  const selectedCount = selectedIds.size

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
        {/* 头部 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + (isDark ? '#303030' : '#f0f0f0') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Title level={5} style={{ margin: 0 }}>视频下载器</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {filteredGroups.length > 0 ? `共 ${filteredGroups.length} 个` : ''}
              </Text>
            </div>
            <Space>
              {downloadingCount > 0 && (
                <Badge count={downloadingCount} size="small">
                  <Button type="text" size="small" icon={<DownloadOutlined />} disabled />
                </Badge>
              )}
              <Dropdown menu={{ items: clearMenuItems }} trigger={['click']}>
                <Button type="text" size="small" icon={<DeleteOutlined />} title="清除" />
              </Dropdown>
              <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => chrome.runtime.openOptionsPage()} title="设置" />
            </Space>
          </div>

          {/* 过滤面板 + 批量操作 */}
          <FilterPanel filter={currentFilter} availableSources={availableSources} onFilterChange={handleFilterChange} onReset={handleResetFilter} />
          <BatchActions
            selectedCount={selectedCount}
            totalCount={totalVideoCount}
            onDownloadSelected={handleDownloadSelected}
            onDownloadAll={handleDownloadAll}
            onClear={handleClearCurrentList}
            downloader={downloader}
            onDownloaderChange={setDownloader}
          />
        </div>

        {/* 视频列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredGroups.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Text type="secondary">未检测到视频/音频</Text></div>
          ) : (
            filteredGroups.map((group) => (
              <div key={`${group.title}|||${group.pageUrl}`} style={{ display: 'flex', alignItems: 'center' }}>
                <VideoGroupItem
                  group={group}
                  downloadTasks={tasks}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onPause={handlePause}
                  onCancel={handleCancel}
                  onRetry={handleRetry}
                  onDownloadGroup={(g) => { for (const v of g.versions) handleDownload(v) }}
                  isDark={isDark}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </ConfigProvider>
  )
}

export default IndexSidePanel
