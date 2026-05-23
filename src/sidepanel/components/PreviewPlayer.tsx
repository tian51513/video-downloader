import React, { useEffect, useRef, useState } from 'react'
import { Typography, Space, Tag, Button } from 'antd'
import { CloseOutlined, PlayCircleOutlined, PauseCircleOutlined, FullscreenOutlined, CustomerServiceOutlined } from '@ant-design/icons'
import type { DetectedVideo } from '../../types'
import { formatFileSize, formatDuration, formatBitrate, getResolutionLabel } from '../../utils/format'
import Hls from 'hls.js'
import dashjs from 'dashjs'

const { Text } = Typography

const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'opus'])

function isAudio(video: DetectedVideo): boolean {
  return video.mediaType === 'audio' || (!video.mediaType && AUDIO_FORMATS.has(video.format as string))
}

const formatColors: Record<string, string> = {
  mp4: 'blue', mkv: 'green', webm: 'cyan', flv: 'orange',
  hls: 'purple', dash: 'magenta', blob: 'default',
  mp3: 'gold', m4a: 'volcano', aac: 'orange', flac: 'green',
  ogg: 'geekblue', wav: 'cyan', wma: 'red', opus: 'purple',
}

interface PreviewPlayerProps {
  video: DetectedVideo
  onClose: () => void
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({ video, onClose }) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audio = isAudio(video)

  useEffect(() => {
    const mediaEl = mediaRef.current
    if (!mediaEl) return

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    if (dashRef.current) { dashRef.current.reset(); dashRef.current = null }

    if (video.format === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(video.url)
        hls.attachMedia(mediaEl as HTMLVideoElement)
      } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
        mediaEl.src = video.url
      }
    } else if (video.format === 'dash') {
      const player = dashjs.MediaPlayer().create()
      dashRef.current = player
      player.initialize(mediaEl as HTMLVideoElement, video.url, false)
    } else {
      mediaEl.src = video.url
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy()
      if (dashRef.current) dashRef.current.reset()
    }
  }, [video])

  const togglePlay = () => {
    const mediaEl = mediaRef.current
    if (!mediaEl) return
    if (mediaEl.paused) { mediaEl.play(); setIsPlaying(true) }
    else { mediaEl.pause(); setIsPlaying(false) }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ position: 'relative', backgroundColor: '#000', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        {audio ? (
          <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} controls style={{ width: '100%', display: 'block' }}
            onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
        ) : (
          <video ref={mediaRef as React.RefObject<HTMLVideoElement>} controls style={{ width: '100%', maxHeight: 300, display: 'block' }}
            onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
        )}
      </div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>
          {audio && <CustomerServiceOutlined style={{ marginRight: 4 }} />}
          {video.title || (audio ? '未命名音频' : '未命名视频')}
        </Text>
        <Space size={4} wrap>
          <Tag color={formatColors[video.format] || 'default'}>{video.format.toUpperCase()}</Tag>
          {!audio && video.height && <Tag>{getResolutionLabel(video.width, video.height)}</Tag>}
          {audio && video.sampleRate && <Text type="secondary">{(video.sampleRate / 1000).toFixed(1)}kHz</Text>}
          {audio && video.channels && <Text type="secondary">{video.channels === 1 ? '单声道' : video.channels === 2 ? '立体声' : `${video.channels}ch`}</Text>}
          {video.bitrate && <Text type="secondary">{formatBitrate(video.bitrate)}</Text>}
          {video.size && <Text type="secondary">{formatFileSize(video.size)}</Text>}
          {video.duration && <Text type="secondary">{formatDuration(video.duration)}</Text>}
          <Text type="secondary">来源: {video.domain}</Text>
        </Space>
      </div>
      <Space>
        <Button type="primary" onClick={togglePlay} icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}>
          {isPlaying ? '暂停' : '播放'}
        </Button>
        {!audio && (
          <Button icon={<FullscreenOutlined />} onClick={() => (mediaRef.current as HTMLVideoElement)?.requestFullscreen()}>全屏</Button>
        )}
        <Button icon={<CloseOutlined />} onClick={onClose}>关闭预览</Button>
      </Space>
    </div>
  )
}
