import React from 'react'
import { Button, Space, Tag, Typography } from 'antd'
import {
  PlayCircleOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { formatFileSize, formatDuration, getResolutionLabel } from '../../utils/format'

const { Text } = Typography

interface VideoItemProps {
  video: DetectedVideo
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
}

const formatColors: Record<string, string> = {
  mp4: 'blue',
  mkv: 'green',
  webm: 'cyan',
  flv: 'orange',
  hls: 'purple',
  dash: 'magenta',
  blob: 'default',
}

export const VideoItem: React.FC<VideoItemProps> = ({ video, onPreview, onDownload }) => {
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong ellipsis style={{ display: 'block', marginBottom: 4 }}>
            {video.title || '未命名视频'}
          </Text>
          <Space size={4} wrap>
            <Tag color={formatColors[video.format] || 'default'} style={{ margin: 0 }}>
              {video.format.toUpperCase()}
            </Tag>
            {video.height && (
              <Tag style={{ margin: 0 }}>{getResolutionLabel(video.width, video.height)}</Tag>
            )}
            {video.size && (
              <Text type="secondary" style={{ fontSize: 12 }}>{formatFileSize(video.size)}</Text>
            )}
            {video.duration && (
              <Text type="secondary" style={{ fontSize: 12 }}>{formatDuration(video.duration)}</Text>
            )}
          </Space>
        </div>
        <Space size={4}>
          <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => onPreview(video)} />
          <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={() => onDownload(video)} />
        </Space>
      </div>
    </div>
  )
}
