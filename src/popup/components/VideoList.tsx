import React from 'react'
import { Empty, Spin, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { DetectedVideo, DownloadTask, VideoGroup } from '../../types'
import { VideoGroupItem } from './VideoItem'

interface VideoListProps {
  groups: VideoGroup[]
  isDetecting: boolean
  downloadTasks: DownloadTask[]
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
  onPause: (taskId: string) => void
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
  onDownloadAll: () => void
  isDark: boolean
}

export const VideoList: React.FC<VideoListProps> = ({
  groups, isDetecting, downloadTasks, onPreview, onDownload, onPause, onCancel, onRetry, onDownloadAll, isDark,
}) => {
  if (isDetecting && groups.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin tip="正在检测..." />
      </div>
    )
  }

  if (groups.length === 0) {
    return <Empty description="未检测到视频/音频" />
  }

  return (
    <div>
      {groups.map((group) => (
        <VideoGroupItem
          key={`${group.title}|||${group.pageUrl}`}
          group={group}
          downloadTasks={downloadTasks}
          onPreview={onPreview}
          onDownload={onDownload}
          onPause={onPause}
          onCancel={onCancel}
          onRetry={onRetry}
          onDownloadGroup={(g) => {
            for (const v of g.versions) onDownload(v)
          }}
          isDark={isDark}
        />
      ))}
      {groups.length > 1 && (
        <div style={{ padding: '8px 12px', textAlign: 'center' }}>
          <Button type="primary" icon={<DownloadOutlined />} onClick={onDownloadAll}>
            全部下载
          </Button>
        </div>
      )}
    </div>
  )
}
