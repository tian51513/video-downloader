import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VideoGroupItem } from '../popup/components/VideoItem'
import type { DetectedVideo, DownloadTask, VideoGroup } from '../types'

/**
 * 测试：视频分组项头部的下载状态渲染（popup / sidepanel 共用组件）
 *
 * 核心行为：
 * 1. downloading 任务 → 头部内联进度条 + 暂停/取消按钮
 * 2. completed 任务 → "已完成" 标签
 * 3. failed 任务 → "失败" 标签 + 重试按钮
 * 4. paused 任务 → "已暂停" 标签
 */

const makeVideo = (): DetectedVideo => ({
  id: 'v1',
  url: 'https://example.com/video.mp4',
  title: '测试视频',
  format: 'mp4',
  mimeType: 'video/mp4',
  source: 'network',
  pageUrl: 'https://example.com/',
  domain: 'example.com',
  detectedAt: 1700000000000,
})

const makeTask = (status: DownloadTask['status'], overrides: Partial<DownloadTask> = {}): DownloadTask =>
  ({
    id: 'dl_1',
    video: makeVideo(),
    status,
    progress: 42,
    speed: 1024,
    downloadedBytes: 4200000,
    totalBytes: 10000000,
    downloader: 'chrome',
    ...overrides,
  }) as DownloadTask

const noop = vi.fn()

const renderWithTask = (task: DownloadTask, handlers: Record<string, (v: any) => void> = {}) => {
  const group: VideoGroup = {
    title: '测试视频',
    pageUrl: 'https://example.com/',
    versions: [makeVideo()],
    primaryIndex: 0,
  }
  return render(
    <VideoGroupItem
      group={group}
      downloadTasks={[task]}
      onPreview={noop}
      onDownload={noop}
      onPause={handlers.onPause ?? noop}
      onCancel={handlers.onCancel ?? noop}
      onRetry={handlers.onRetry ?? noop}
      onDownloadGroup={noop}
      isDark={false}
    />
  )
}

describe('VideoGroupItem 下载状态渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('downloading：渲染进度条与操作按钮，取消按钮回调携带 taskId', () => {
    const onCancel = vi.fn()
    const { container } = renderWithTask(makeTask('downloading'), { onCancel })

    // antd Progress 进度条存在
    expect(container.querySelector('.ant-progress')).toBeInTheDocument()
    // danger 样式的取消按钮存在
    const cancelBtn = container.querySelector('.ant-btn-dangerous') as HTMLElement
    expect(cancelBtn).toBeTruthy()

    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledWith('dl_1')
  })

  it('completed：显示"已完成"标签', () => {
    renderWithTask(makeTask('completed'))

    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('failed：显示"失败"标签，重试按钮回调携带 taskId', () => {
    const onRetry = vi.fn()
    const { container } = renderWithTask(makeTask('failed'), { onRetry })

    expect(screen.getByText('失败')).toBeInTheDocument()

    // failed 状态下头部唯一的按钮是重试
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(buttons[0])
    expect(onRetry).toHaveBeenCalledWith('dl_1')
  })

  it('paused：显示"已暂停"标签', () => {
    renderWithTask(makeTask('paused'))

    expect(screen.getByText('已暂停')).toBeInTheDocument()
  })
})
