import React, { useCallback } from 'react'
import { ConfigProvider, theme, Typography, Space, Button, Badge, Dropdown } from 'antd'
import { SettingOutlined, AppstoreOutlined, DeleteOutlined, HistoryOutlined, ScissorOutlined, CloseCircleOutlined, ClearOutlined } from '@ant-design/icons'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { useExtensionBridge } from '../ui/useExtensionBridge'
import { VideoList } from './components/VideoList'
import type { DetectedVideo } from '../types'

const { Title, Text } = Typography

function IndexPopup() {
  const { filteredGroups, isDetecting } = useVideoStore()
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

  const handlePreview = useCallback((video: DetectedVideo) => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(
        `tabs/preview.html?url=${encodeURIComponent(video.url)}&format=${video.format}&title=${encodeURIComponent(video.title)}`
      ),
    })
  }, [])

  const handleDownloadWithDefault = useCallback(
    (video: DetectedVideo) => handleDownload(video, settings.defaultDownloader),
    [handleDownload, settings.defaultDownloader]
  )

  const handleDownloadAll = useCallback(() => {
    for (const group of filteredGroups) {
      for (const video of group.versions) {
        handleDownload(video, settings.defaultDownloader)
      }
    }
  }, [filteredGroups, handleDownload, settings.defaultDownloader])

  const handleOpenSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }, [])

  const clearMenuItems = [
    { key: 'all', icon: <DeleteOutlined />, label: '清除所有视频', onClick: clearAllVideos },
    { key: 'current', icon: <DeleteOutlined />, label: '清除当前页面下载', onClick: clearCurrentPageDownloads },
    { key: 'completed', icon: <HistoryOutlined />, label: '清除已完成', onClick: clearCompleted },
    { key: 'completed-full', icon: <ScissorOutlined />, label: '清除已完成(完整)', onClick: clearCompletedFull },
    { key: 'failed', icon: <CloseCircleOutlined />, label: '清除失败', onClick: clearFailed },
    { key: 'orphaned', icon: <ClearOutlined />, label: '清除已关闭页面', onClick: clearOrphaned },
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
            onDownload={handleDownloadWithDefault}
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
