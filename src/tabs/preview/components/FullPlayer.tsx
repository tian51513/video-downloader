import React, { useEffect, useRef } from 'react'
import { Typography, Space, Tag, Button } from 'antd'
import { DownloadOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import type { DetectedVideo } from '../../../types'
import { formatFileSize, formatDuration, getResolutionLabel } from '../../../utils/format'
import Hls from 'hls.js'
import dashjs from 'dashjs'

const { Title, Text } = Typography

interface FullPlayerProps {
  video: DetectedVideo
  onDownload: () => void
  onBack: () => void
}

export const FullPlayer: React.FC<FullPlayerProps> = ({ video, onDownload, onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<any>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    if (dashRef.current) { dashRef.current.reset(); dashRef.current = null }

    if (video.format === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(video.url)
        hls.attachMedia(videoEl)
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = video.url
      }
    } else if (video.format === 'dash') {
      const player = dashjs.MediaPlayer().create()
      dashRef.current = player
      player.initialize(videoEl, video.url, false)
    } else {
      videoEl.src = video.url
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy()
      if (dashRef.current) dashRef.current.reset()
    }
  }, [video])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, background: '#000', minHeight: '100vh', color: '#fff' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ color: '#fff' }}>返回</Button>
        <Button type="primary" icon={<DownloadOutlined />} onClick={onDownload}>下载</Button>
      </Space>
      <video
        ref={videoRef}
        controls
        autoPlay
        style={{ width: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 8 }}
      />
      <div style={{ marginTop: 16 }}>
        <Title level={4} style={{ color: '#fff', margin: '0 0 8px' }}>{video.title || '未命名视频'}</Title>
        <Space wrap>
          <Tag>{video.format.toUpperCase()}</Tag>
          {video.height && <Tag>{getResolutionLabel(video.width, video.height)}</Tag>}
          {video.size && <Text style={{ color: '#999' }}>{formatFileSize(video.size)}</Text>}
          {video.duration && <Text style={{ color: '#999' }}>{formatDuration(video.duration)}</Text>}
          <Text style={{ color: '#999' }}>来源: {video.domain}</Text>
        </Space>
      </div>
    </div>
  )
}