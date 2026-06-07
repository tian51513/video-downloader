import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { VideoItem } from '../popup/components/VideoItem'
import type { DetectedVideo } from '../types'

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

const h = React.createElement

/** 获取版本面板容器 */
function getPanel() {
  return screen.getByText('当前').closest('div')!.parentElement!
}

describe('VideoItem 版本展开面板', () => {
  it('多版本时应显示展开箭头按钮', () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000, bitrate: 4_264_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000, bitrate: 2_044_000 }),
      makeVideo({ id: 'v-480', width: 854, height: 480, size: 19_000_000, bitrate: 1_064_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    expect(screen.getByTitle('展开版本')).toBeInTheDocument()
  })

  it('单版本时不应显示展开箭头', () => {
    const video = makeVideo({ width: 1920, height: 1080 })
    render(
      h(VideoItem, {
        video,
        sameVersions: [video],
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    expect(screen.queryByTitle('展开版本')).not.toBeInTheDocument()
  })

  it('点击展开箭头应显示版本面板', async () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000, bitrate: 4_264_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000, bitrate: 2_044_000 }),
      makeVideo({ id: 'v-480', width: 854, height: 480, size: 19_000_000, bitrate: 1_064_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    // 面板初始不可见
    expect(screen.queryByText('当前')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTitle('展开版本'))

    // 面板可见，通过行内容验证
    const panel = getPanel()
    const rows = panel.querySelectorAll('div[style*="cursor: pointer"]')
    expect(rows).toHaveLength(3)
    // 验证每行都包含比特率信息
    expect(rows[0].textContent).toContain('4.3 Mbps')
    expect(rows[1].textContent).toContain('2.0 Mbps')
    expect(rows[2].textContent).toContain('1.1 Mbps')
  })

  it('再次点击展开箭头应收起面板', async () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000, bitrate: 4_264_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000, bitrate: 2_044_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    await userEvent.click(screen.getByTitle('展开版本'))
    expect(screen.getByText('当前')).toBeInTheDocument()

    await userEvent.click(screen.getByTitle('展开版本'))
    expect(screen.queryByText('当前')).not.toBeInTheDocument()
  })

  it('版本行应按分辨率降序排列', async () => {
    // 传入乱序的版本列表
    const video = makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-480', width: 854, height: 480, size: 19_000_000 }),
      makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    await userEvent.click(screen.getByTitle('展开版本'))

    const panel = getPanel()
    const rows = panel.querySelectorAll('div[style*="cursor: pointer"]')
    // 第一行应该包含 1080p
    expect(rows[0].textContent).toContain('1080p')
    // 最后一行应该包含 480p
    expect(rows[rows.length - 1].textContent).toContain('480p')
  })

  it('当前版本应标记为"当前"', async () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000, bitrate: 4_264_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000, bitrate: 2_044_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    await userEvent.click(screen.getByTitle('展开版本'))

    const currentLabels = screen.getAllByText('当前')
    expect(currentLabels).toHaveLength(1)
  })

  it('点击版本行应切换选中版本并收起面板', async () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000, bitrate: 4_264_000 })
    const version720 = makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000, bitrate: 2_044_000 })
    const sameVersions = [video, version720]
    const onDownload = vi.fn()

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload,
      })
    )

    await userEvent.click(screen.getByTitle('展开版本'))

    // 点击包含 720p 的版本行
    const panel = getPanel()
    const rows = panel.querySelectorAll('div[style*="cursor: pointer"]')
    const row720 = Array.from(rows).find(r => r.textContent!.includes('720p'))!
    await userEvent.click(row720)

    // 不应触发下载（选择版本不等于下载）
    expect(onDownload).not.toHaveBeenCalled()
    // 面板应收起
    expect(screen.queryByText('当前')).not.toBeInTheDocument()
    // 主区域应显示 720p 的标签
    expect(screen.getByText('720p')).toBeInTheDocument()
  })

  it('版本行应显示完整的分辨率、比特率、大小、格式信息', async () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000, bitrate: 4_264_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    await userEvent.click(screen.getByTitle('展开版本'))

    // 当前版本行应包含所有信息
    const panel = getPanel()
    const firstRow = panel.querySelectorAll('div[style*="cursor: pointer"]')[0]
    expect(firstRow.textContent).toContain('1080p')
    expect(firstRow.textContent).toContain('4.3 Mbps')
    expect(firstRow.textContent).toContain('124.9 MB')
    expect(firstRow.textContent).toContain('MP4')
  })

  it('缺少比特率时版本行应正常显示其他信息', async () => {
    const video = makeVideo({ id: 'v-1080', width: 1920, height: 1080, size: 131_000_000 })
    const sameVersions = [
      video,
      makeVideo({ id: 'v-720', width: 1280, height: 720, size: 44_000_000 }),
    ]

    render(
      h(VideoItem, {
        video,
        sameVersions,
        onPreview: vi.fn(),
        onDownload: vi.fn(),
      })
    )

    await userEvent.click(screen.getByTitle('展开版本'))

    const panel = getPanel()
    const firstRow = panel.querySelectorAll('div[style*="cursor: pointer"]')[0]
    expect(firstRow.textContent).toContain('1080p')
    expect(firstRow.textContent).toContain('124.9 MB')
    expect(firstRow.textContent).toContain('MP4')
    // 不应有比特率信息（没有 Mbps 或 Kbps）
    expect(firstRow.textContent).not.toMatch(/Mbps|Kbps/)
  })
})
