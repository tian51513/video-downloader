import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { VideoItem } from '../popup/components/VideoItem'
import type { DetectedVideo, DownloadTask } from '../types'

/**
 * SidePanel 下载状态测试
 *
 * SidePanel 通过 VideoItem 组件显示下载状态。
 * 这里直接测试 VideoItem 在不同下载状态下的渲染行为，
 * 验证 SidePanel 传入 downloadTask props 后 VideoItem 能正确显示。
 */

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
})

const h = React.createElement

function makeVideo(overrides: Partial<DetectedVideo> = {}): DetectedVideo {
  return {
    id: 'v1',
    url: 'https://example.com/video.mp4',
    title: 'Test Video',
    format: 'mp4',
    mimeType: 'video/mp4',
    source: 'network',
    pageUrl: 'https://example.com',
    domain: 'example.com',
    detectedAt: Date.now(),
    ...overrides,
  }
}

function makeDownloadTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'task-1',
    video: makeVideo(),
    status: 'downloading',
    progress: 0,
    speed: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloader: 'chrome',
    ...overrides,
  }
}

describe('SidePanel 下载状态（通过 VideoItem 验证）', () => {
  it('下载中时应显示进度条和速度', () => {
    const video = makeVideo({ id: 'v1', width: 1920, height: 1080, size: 131_000_000 })
    const task = makeDownloadTask({
      id: 'task-1',
      video,
      status: 'downloading',
      progress: 45,
      speed: 2_000_000,
      downloadedBytes: 60_000_000,
      totalBytes: 131_000_000,
    })

    render(
      h(VideoItem, {
        video,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
        downloadTasks: [task],
        onPauseDownload: vi.fn(),
        onCancelDownload: vi.fn(),
      })
    )

    // Ant Design Progress 组件渲染进度条
    const progressBar = document.querySelector('.ant-progress')
    expect(progressBar).toBeInTheDocument()
    // 应该有暂停按钮（下载中状态）
    const pauseIcon = document.querySelector('.anticon-pause-circle')
    expect(pauseIcon).toBeInTheDocument()
    // 应该有取消按钮
    const deleteIcon = document.querySelector('.anticon-delete')
    expect(deleteIcon).toBeInTheDocument()
  })

  it('下载完成时应显示勾号图标', () => {
    const video = makeVideo({ id: 'v1' })
    const task = makeDownloadTask({
      video,
      status: 'completed',
      progress: 100,
    })

    render(
      h(VideoItem, {
        video,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
        downloadTasks: [task],
        onPauseDownload: vi.fn(),
        onCancelDownload: vi.fn(),
      })
    )

    const checkIcon = document.querySelector('.anticon-check-circle')
    expect(checkIcon).toBeInTheDocument()
  })

  it('下载失败时应显示删除按钮', () => {
    const video = makeVideo({ id: 'v1' })
    const task = makeDownloadTask({
      video,
      status: 'failed',
      error: 'network error',
    })

    render(
      h(VideoItem, {
        video,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
        downloadTasks: [task],
        onPauseDownload: vi.fn(),
        onCancelDownload: vi.fn(),
      })
    )

    const deleteIcon = document.querySelector('.anticon-delete')
    expect(deleteIcon).toBeInTheDocument()
  })

  it('暂停时应显示暂停进度条和恢复按钮', () => {
    const video = makeVideo({ id: 'v1' })
    const task = makeDownloadTask({
      video,
      status: 'paused',
      progress: 30,
    })

    render(
      h(VideoItem, {
        video,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
        downloadTasks: [task],
        onPauseDownload: vi.fn(),
        onCancelDownload: vi.fn(),
      })
    )

    // 应该有暂停样式的进度条
    const progressBar = document.querySelector('.ant-progress-status-exception')
    expect(progressBar).toBeInTheDocument()
    // 暂停时应显示恢复下载按钮
    const downloadIcon = document.querySelector('.anticon-download')
    expect(downloadIcon).toBeInTheDocument()
  })

  it('视频应显示格式和分辨率标签', () => {
    const video = makeVideo({
      id: 'v1',
      width: 1920,
      height: 1080,
      size: 131_000_000,
      format: 'hls',
    })

    render(
      h(VideoItem, {
        video,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    expect(screen.getByText('HLS')).toBeInTheDocument()
    expect(screen.getByText('1080p')).toBeInTheDocument()
  })
})
