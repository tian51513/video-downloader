import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VideoGroupItem } from '../popup/components/VideoItem'
import type { DetectedVideo, DownloadTask, VideoGroup } from '../types'

/**
 * 测试：视频分组项的版本面板（VideoGroupItem 真实 API）
 *
 * 核心行为：
 * 1. 多版本分组默认折叠，头部显示主版本与"N 个版本"
 * 2. 点击头部展开，显示每个版本行与"全部下载"
 * 3. "全部下载"回调携带整个分组
 */

const makeVideo = (overrides: Partial<DetectedVideo> = {}): DetectedVideo => ({
  id: 'v_' + Math.random().toString(36).slice(2, 8),
  url: 'https://example.com/video.mp4',
  title: '测试视频',
  format: 'mp4',
  mimeType: 'video/mp4',
  source: 'network',
  pageUrl: 'https://example.com/',
  domain: 'example.com',
  detectedAt: 1700000000000,
  ...overrides,
})

const makeGroup = (versions: DetectedVideo[]): VideoGroup => ({
  title: versions[0].title,
  pageUrl: versions[0].pageUrl,
  versions,
  primaryIndex: 0,
})

const noop = vi.fn()

const renderGroup = (group: VideoGroup, downloadTasks: DownloadTask[] = []) =>
  render(
    <VideoGroupItem
      group={group}
      downloadTasks={downloadTasks}
      onPreview={noop}
      onDownload={noop}
      onPause={noop}
      onCancel={noop}
      onRetry={noop}
      onDownloadGroup={noop}
      isDark={false}
    />
  )

describe('VideoGroupItem 版本面板', () => {
  it('多版本分组默认折叠：显示主版本标题与"2 个版本"，不显示版本行', () => {
    const group = makeGroup([
      makeVideo({ title: '测试视频', format: 'mp4' }),
      makeVideo({ title: '测试视频', format: 'hls', url: 'https://example.com/master.m3u8' }),
    ])

    renderGroup(group)

    expect(screen.getByText('测试视频')).toBeInTheDocument()
    expect(screen.getByText('2 个版本')).toBeInTheDocument()
    // 折叠状态：不渲染"全部下载"按钮
    expect(screen.queryByText(/全部下载/)).not.toBeInTheDocument()
  })

  it('单版本分组不可展开：无版本计数', () => {
    renderGroup(makeGroup([makeVideo()]))

    expect(screen.queryByText(/个版本/)).not.toBeInTheDocument()
    expect(screen.queryByText(/全部下载/)).not.toBeInTheDocument()
  })

  it('点击头部展开：显示各版本行与"全部下载 (2 个版本)"', () => {
    const group = makeGroup([
      makeVideo({ title: '测试视频', format: 'mp4' }),
      makeVideo({ title: '测试视频', format: 'hls', url: 'https://example.com/master.m3u8' }),
    ])

    renderGroup(group)

    // 点击头部（版本计数文本位于头部区域内，事件冒泡触发折叠切换）
    fireEvent.click(screen.getByText('2 个版本'))

    expect(screen.getByText(/全部下载 \(2 个版本\)/)).toBeInTheDocument()
    // 两个版本行的格式标签
    expect(screen.getAllByText('MP4').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('HLS').length).toBeGreaterThanOrEqual(1)
  })

  it('点击"全部下载"：onDownloadGroup 携带整个分组并收起面板', () => {
    const onDownloadGroup = vi.fn()
    const group = makeGroup([
      makeVideo({ title: '测试视频', format: 'mp4' }),
      makeVideo({ title: '测试视频', format: 'hls', url: 'https://example.com/master.m3u8' }),
    ])

    render(
      <VideoGroupItem
        group={group}
        downloadTasks={[]}
        onPreview={noop}
        onDownload={noop}
        onPause={noop}
        onCancel={noop}
        onRetry={noop}
        onDownloadGroup={onDownloadGroup}
        isDark={false}
      />
    )

    fireEvent.click(screen.getByText('2 个版本'))
    fireEvent.click(screen.getByText(/全部下载 \(2 个版本\)/))

    expect(onDownloadGroup).toHaveBeenCalledTimes(1)
    expect(onDownloadGroup.mock.calls[0][0]).toBe(group)
    // 点击后收起
    expect(screen.queryByText(/全部下载/)).not.toBeInTheDocument()
  })
})
