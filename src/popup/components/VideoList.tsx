import React from 'react'
import { Empty, Spin, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { VideoItem } from './VideoItem'

interface VideoListProps {
  videos: DetectedVideo[]
  isDetecting: boolean
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
  onDownloadAll: () => void
}

export const VideoList: React.FC<VideoListProps> = ({
  videos, isDetecting, onPreview, onDownload, onDownloadAll,
}) => {
  if (isDetecting && videos.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin tip="正在检测视频..." />
      </div>
    )
  }

  if (videos.length === 0) {
    return <Empty description="未检测到视频" />
  }

  return (
    <div>
      {videos.map((video) => (
        <VideoItem key={video.id} video={video} onPreview={onPreview} onDownload={onDownload} />
      ))}
      {videos.length > 1 && (
        <div style={{ padding: '8px 12px', textAlign: 'center' }}>
          <Button type="primary" icon={<DownloadOutlined />} onClick={onDownloadAll}>
            全部下载
          </Button>
        </div>
      )}
    </div>
  )
}
