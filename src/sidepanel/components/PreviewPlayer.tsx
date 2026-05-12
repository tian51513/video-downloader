import React, { useEffect, useRef, useState } from 'react'
import { Typography, Space, Tag, Button } from 'antd'
import { CloseOutlined, PlayCircleOutlined, PauseCircleOutlined, FullscreenOutlined } from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { formatFileSize, formatDuration, getResolutionLabel } from '../../utils/format'
import Hls from 'hls.js'
import dashjs from 'dashjs'

const { Text } = Typography

interface PreviewPlayerProps {
  video: DetectedVideo
  onClose: () => void
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({ video, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)

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

  const togglePlay = () => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (videoEl.paused) { videoEl.play(); setIsPlaying(true) }
    else { videoEl.pause(); setIsPlaying(false) }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ position: 'relative', backgroundColor: '#000', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <video ref={videoRef} controls style={{ width: '100%', maxHeight: 300, display: 'block' }}
          onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>{video.title || '未命名视频'}</Text>
        <Space size={4} wrap>
          <Tag color="purple">{video.format.toUpperCase()}</Tag>
          {video.height && <Tag>{getResolutionLabel(video.width, video.height)}</Tag>}
          {video.size && <Text type="secondary">{formatFileSize(video.size)}</Text>}
          {video.duration && <Text type="secondary">{formatDuration(video.duration)}</Text>}
          <Text type="secondary">来源: {video.domain}</Text>
        </Space>
      </div>
      <Space>
        <Button type="primary" onClick={togglePlay} icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}>
          {isPlaying ? '暂停' : '播放'}
        </Button>
        <Button icon={<FullscreenOutlined />} onClick={() => videoRef.current?.requestFullscreen()}>全屏</Button>
        <Button icon={<CloseOutlined />} onClick={onClose}>关闭预览</Button>
      </Space>
    </div>
  )
}
