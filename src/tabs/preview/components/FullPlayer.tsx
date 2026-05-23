import React, { useEffect, useRef } from 'react'
import { Typography, Space, Tag, Button } from 'antd'
import { DownloadOutlined, ArrowLeftOutlined, CustomerServiceOutlined } from '@ant-design/icons'
import type { DetectedVideo } from '../../../types'
import { formatFileSize, formatDuration, formatBitrate, getResolutionLabel } from '../../../utils/format'
import Hls from 'hls.js'
import dashjs from 'dashjs'

const { Title, Text } = Typography

const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'opus'])

function isAudio(video: DetectedVideo): boolean {
  return video.mediaType === 'audio' || (!video.mediaType && AUDIO_FORMATS.has(video.format as string))
}

interface FullPlayerProps {
  video: DetectedVideo
  onDownload: () => void
  onBack: () => void
}

export const FullPlayer: React.FC<FullPlayerProps> = ({ video, onDownload, onBack }) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<any>(null)
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

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, background: '#000', minHeight: '100vh', color: '#fff' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ color: '#fff' }}>返回</Button>
        <Button type="primary" icon={<DownloadOutlined />} onClick={onDownload}>下载</Button>
      </Space>
      {audio ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <CustomerServiceOutlined style={{ fontSize: 64, color: '#fff', marginBottom: 16, display: 'block' }} />
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            controls
            autoPlay
            style={{ width: '100%', maxWidth: 600, display: 'block', margin: '0 auto' }}
          />
        </div>
      ) : (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          controls
          autoPlay
          style={{ width: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 8 }}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <Title level={4} style={{ color: '#fff', margin: '0 0 8px' }}>
          {audio && <CustomerServiceOutlined style={{ marginRight: 8 }} />}
          {video.title || (audio ? '未命名音频' : '未命名视频')}
        </Title>
        <Space wrap>
          <Tag>{video.format.toUpperCase()}</Tag>
          {!audio && video.height && <Tag>{getResolutionLabel(video.width, video.height)}</Tag>}
          {audio && video.sampleRate && <Text style={{ color: '#999' }}>{(video.sampleRate / 1000).toFixed(1)}kHz</Text>}
          {audio && video.channels && <Text style={{ color: '#999' }}>{video.channels === 1 ? '单声道' : video.channels === 2 ? '立体声' : `${video.channels}ch`}</Text>}
          {video.bitrate && <Text style={{ color: '#999' }}>{formatBitrate(video.bitrate)}</Text>}
          {video.size && <Text style={{ color: '#999' }}>{formatFileSize(video.size)}</Text>}
          {video.duration && <Text style={{ color: '#999' }}>{formatDuration(video.duration)}</Text>}
          <Text style={{ color: '#999' }}>来源: {video.domain}</Text>
        </Space>
      </div>
    </div>
  )
}
