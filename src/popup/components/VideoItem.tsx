import React, { useState, useMemo } from 'react'
import { Button, Space, Tag, Typography, Progress } from 'antd'
import {
  PlayCircleOutlined,
  DownloadOutlined,
  CustomerServiceOutlined,
  DownOutlined,
  RightOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined,
  RedoOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import type { DetectedVideo, DownloadTask, VideoGroup } from '../../types'
import { formatFileSize, formatDuration, formatBitrate, formatSpeed, getResolutionLabel } from '../../utils/format'

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

export function getTaskForVideo(video: DetectedVideo, tasks: DownloadTask[]): DownloadTask | undefined {
  return tasks.find((t) => t.video.url === video.url)
}

// ===== 版本行（展开面板内的每一行） =====
interface VersionRowProps {
  video: DetectedVideo
  task?: DownloadTask
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
  onPause: (taskId: string) => void
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
  isDark: boolean
}

const VersionRow: React.FC<VersionRowProps> = ({
  video, task, onPreview, onDownload, onPause, onCancel, onRetry, isDark,
}) => {
  const audio = isAudio(video)
  const isActive = task?.status === 'downloading' || task?.status === 'merging'
  const borderColor = isDark ? '#303030' : '#f0f0f0'

  return (
    <div style={{ padding: '6px 12px 6px 24px', borderBottom: '1px solid ' + borderColor }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size={4} wrap style={{ flex: 1, minWidth: 0 }}>
          <Tag color={formatColors[video.format] || 'default'} style={{ margin: 0 }}>
            {video.format.toUpperCase()}
          </Tag>
          {!audio && video.height && (
            <Text type="secondary" style={{ fontSize: 12 }}>{getResolutionLabel(video.width, video.height)}</Text>
          )}
          {audio && video.sampleRate && (
            <Text type="secondary" style={{ fontSize: 12 }}>{(video.sampleRate / 1000).toFixed(1)}kHz</Text>
          )}
          {audio && video.channels && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {video.channels === 1 ? '单声道' : video.channels === 2 ? '立体声' : `${video.channels}ch`}
            </Text>
          )}
          {video.bitrate && (
            <Text type="secondary" style={{ fontSize: 12 }}>{formatBitrate(video.bitrate)}</Text>
          )}
          {video.size ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{formatFileSize(video.size)}</Text>
          ) : null}
          {video.duration && (
            <Text type="secondary" style={{ fontSize: 12 }}>{formatDuration(video.duration)}</Text>
          )}
        </Space>
        <Space size={2}>
          {!isActive && !task && (
            <>
              <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => onPreview(video)} />
              <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={() => onDownload(video)} />
            </>
          )}
          {isActive && (
            <>
              <Button type="text" size="small" icon={<PauseCircleOutlined />} onClick={() => onPause(task!.id)} />
              <Button type="text" size="small" danger icon={<CloseCircleOutlined />} onClick={() => onCancel(task!.id)} />
            </>
          )}
          {task?.status === 'completed' && (
            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
          )}
          {task?.status === 'failed' && (
            <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => onRetry(task!.id)} />
          )}
          {task?.status === 'paused' && (
            <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => onRetry(task!.id)} title="继续" />
          )}
        </Space>
      </div>
      {/* 内联进度条 */}
      {isActive && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {task!.totalBytes > 0
                ? `${formatFileSize(task!.downloadedBytes)} / ${formatFileSize(task!.totalBytes)}`
                : formatFileSize(task!.downloadedBytes)}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {task!.speed > 0 ? formatSpeed(task!.speed) : ''}
            </Text>
          </div>
          <Progress
            percent={Math.round(task!.progress)}
            size="small"
            showInfo={false}
            strokeColor="#1677ff"
            style={{ marginBottom: 0 }}
          />
        </div>
      )}
    </div>
  )
}

// ===== 视频分组项 =====
export interface VideoGroupItemProps {
  group: VideoGroup
  downloadTasks: DownloadTask[]
  onPreview: (video: DetectedVideo) => void
  onDownload: (video: DetectedVideo) => void
  onPause: (taskId: string) => void
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
  onDownloadGroup: (group: VideoGroup) => void
  isDark: boolean
}

export const VideoGroupItem: React.FC<VideoGroupItemProps> = ({
  group, downloadTasks, onPreview, onDownload, onPause, onCancel, onRetry, onDownloadGroup, isDark,
}) => {
  const [expanded, setExpanded] = useState(false)
  const primary = group.versions[group.primaryIndex]
  const audio = isAudio(primary)
  const hasMultiple = group.versions.length > 1

  // 查找正在下载/已完成/失败的版本（优先显示在折叠头部）
  const activeVersion = useMemo(
    () => group.versions.find((v) => {
      const t = getTaskForVideo(v, downloadTasks)
      return t && (t.status === 'downloading' || t.status === 'merging')
    }),
    [group.versions, downloadTasks]
  )
  // 折叠头部显示的版本：有活跃下载时显示活跃版本，否则显示主版本
  const displayVersion = activeVersion || primary

  // 主版本的任务状态
  const primaryTask = useMemo(
    () => getTaskForVideo(primary, downloadTasks),
    [primary, downloadTasks]
  )
  const primaryActive = primaryTask?.status === 'downloading' || primaryTask?.status === 'merging'
  const activeTask = activeVersion ? getTaskForVideo(activeVersion, downloadTasks) : undefined
  const activeActive = activeTask?.status === 'downloading' || activeTask?.status === 'merging'
  const borderColor = isDark ? '#303030' : '#f0f0f0'
  const bgColor = isDark ? '#1a1a1a' : '#fafafa'

  return (
    <div style={{ borderBottom: '1px solid ' + borderColor }}>
      {/* 折叠头部 */}
      <div
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          background: expanded ? bgColor : undefined,
        }}
        onClick={() => hasMultiple && setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong ellipsis style={{ display: 'block', marginBottom: 4 }}>
              {audio ? <CustomerServiceOutlined style={{ marginRight: 4 }} /> : null}
              {displayVersion.title || primary.title || (audio ? '未命名音频' : '未命名视频')}
            </Text>
            <Space size={4} wrap>
              <Tag color={formatColors[displayVersion.format] || 'default'} style={{ margin: 0 }}>
                {displayVersion.format.toUpperCase()}
              </Tag>
              {!audio && displayVersion.height && (
                <Tag style={{ margin: 0 }}>{getResolutionLabel(displayVersion.width, displayVersion.height)}</Tag>
              )}
              {audio && displayVersion.sampleRate && (
                <Text type="secondary" style={{ fontSize: 12 }}>{(displayVersion.sampleRate / 1000).toFixed(1)}kHz</Text>
              )}
              {displayVersion.size ? (
                <Text type="secondary" style={{ fontSize: 12 }}>{formatFileSize(displayVersion.size)}</Text>
              ) : null}
              {displayVersion.duration && (
                <Text type="secondary" style={{ fontSize: 12 }}>{formatDuration(displayVersion.duration)}</Text>
              )}
              {hasMultiple && (
                <Text type="secondary" style={{ fontSize: 12 }}>{group.versions.length} 个版本</Text>
              )}
              {hasMultiple && (
                expanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />
              )}
            </Space>
          </div>
          <Space size={2} onClick={(e) => e.stopPropagation()}>
            {/* 下载进度内联：优先显示活跃版本的进度 */}
            {activeActive && activeTask && (
              <div style={{ width: 120 }}>
                <Progress
                  percent={Math.round(activeTask.progress)}
                  size="small"
                  showInfo={false}
                  strokeColor="#1677ff"
                />
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {activeTask.speed > 0 ? formatSpeed(activeTask.speed) : ''}
                </Text>
              </div>
            )}
            {activeTask?.status === 'completed' && (
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
            )}
            {!activeActive && !activeTask && !primaryActive && !primaryTask && (
              <>
                <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => onPreview(primary)} />
                <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={() => onDownload(primary)} />
              </>
            )}
            {activeActive && (
              <>
                <Button type="text" size="small" icon={<PauseCircleOutlined />} onClick={() => onPause(activeTask!.id)} />
                <Button type="text" size="small" danger icon={<CloseCircleOutlined />} onClick={() => onCancel(activeTask!.id)} />
              </>
            )}
            {activeTask?.status === 'failed' && (
              <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => onRetry(activeTask!.id)} />
            )}
            {activeTask?.status === 'paused' && (
              <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => onRetry(activeTask!.id)} title="继续" />
            )}
          </Space>
        </div>
      </div>

      {/* 展开版本列表 */}
      {expanded && hasMultiple && (
        <div>
          {group.versions.map((version, idx) => (
            <VersionRow
              key={version.id}
              video={version}
              task={getTaskForVideo(version, downloadTasks)}
              onPreview={onPreview}
              onDownload={onDownload}
              onPause={onPause}
              onCancel={onCancel}
              onRetry={onRetry}
              isDark={isDark}
            />
          ))}
          {group.versions.length > 1 && (
            <div style={{ padding: '6px 12px', textAlign: 'center', borderBottom: '1px solid ' + borderColor }}>
              <Button type="link" size="small" onClick={() => onDownloadGroup(group)}>
                全部下载 ({group.versions.length} 个版本)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
