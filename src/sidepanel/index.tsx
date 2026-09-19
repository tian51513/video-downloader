import React, { useState, useCallback } from 'react'
import { ConfigProvider, theme, Typography, Badge, Space, Button, Dropdown } from 'antd'
import { SettingOutlined, DownloadOutlined, DeleteOutlined, HistoryOutlined, ScissorOutlined, CloseCircleOutlined, ClearOutlined } from '@ant-design/icons'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { useExtensionBridge } from '../ui/useExtensionBridge'
import { VideoGroupItem } from '../popup/components/VideoItem'
import { FilterPanel } from './components/FilterPanel'
import { BatchActions } from './components/BatchActions'
import { PreviewPlayer } from './components/PreviewPlayer'
import type { DetectedVideo, DownloaderType, VideoFilter, VideoGroup } from '../types'

const { Title, Text } = Typography

const ALL_FORMATS: VideoFilter['formats'] = ['mp4', 'mkv', 'webm', 'flv', 'avi', 'hls', 'dash', 'blob', 'ts', 'mp3', 'm4a', 'flac', 'ogg', 'wav']

function IndexSidePanel() {
  const { filteredGroups, currentFilter, setFilter } = useVideoStore()
  const { settings } = useSettingsStore()
  const {
    tasks,
    handleDownload,
    handlePause,
    handleCancel,
    handleRetry,
    clearAllVideos,
    clearCurrentPageDownloads,
    clearCompleted,
    clearCompletedFull,
    clearFailed,
    clearOrphaned,
    downloadingCount,
    isDark,
  } = useExtensionBridge()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewVideo, setPreviewVideo] = useState<DetectedVideo | null>(null)
  const [downloader, setDownloader] = useState<DownloaderType>('chrome')

  const handleFilterChange = useCallback((filter: Partial<VideoFilter>) => setFilter(filter), [setFilter])
  const handleResetFilter = useCallback(() => {
    setFilter({ formats: ALL_FORMATS, minResolution: 'any', minSize: 'any', minDuration: 'any', sources: [], videoType: 'all', sortBy: 'detectedAt', sortOrder: 'desc' })
  }, [setFilter])

  const handleDownloadWithCurrent = useCallback(
    (video: DetectedVideo) => handleDownload(video, downloader),
    [handleDownload, downloader]
  )

  const handleDownloadSelected = useCallback(() => {
    for (const group of filteredGroups) {
      for (const video of group.versions) {
        if (selectedIds.has(video.id)) handleDownload(video, downloader)
      }
    }
  }, [filteredGroups, selectedIds, handleDownload, downloader])

  const handleDownloadAll = useCallback(() => {
    for (const group of filteredGroups) {
      for (const video of group.versions) handleDownload(video, downloader)
    }
  }, [filteredGroups, handleDownload, downloader])

  const handleDownloadGroup = useCallback(
    (group: VideoGroup) => {
      for (const v of group.versions) handleDownload(v, downloader)
    },
    [handleDownload, downloader]
  )

  const clearMenuItems = [
    { key: 'all', icon: <DeleteOutlined />, label: '清除所有视频', onClick: clearAllVideos },
    { key: 'current', icon: <DeleteOutlined />, label: '清除当前页面下载', onClick: clearCurrentPageDownloads },
    { key: 'completed', icon: <HistoryOutlined />, label: '清除已完成', onClick: clearCompleted },
    { key: 'completed-full', icon: <ScissorOutlined />, label: '清除已完成(完整)', onClick: clearCompletedFull },
    { key: 'failed', icon: <CloseCircleOutlined />, label: '清除失败', onClick: clearFailed },
    { key: 'orphaned', icon: <ClearOutlined />, label: '清除已关闭页面', onClick: clearOrphaned },
  ]

  const availableSources = [...new Set(filteredGroups.flatMap((g) => g.versions.map((v) => v.domain)))]

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
            onClear={clearCurrentPageDownloads}
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
                  onPreview={setPreviewVideo}
                  onDownload={handleDownloadWithCurrent}
                  onPause={handlePause}
                  onCancel={handleCancel}
                  onRetry={handleRetry}
                  onDownloadGroup={handleDownloadGroup}
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
