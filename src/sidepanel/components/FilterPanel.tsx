import React, { useState } from 'react'
import { Collapse, Checkbox, Select, Button, Space, Typography } from 'antd'
import { FilterOutlined, UndoOutlined } from '@ant-design/icons'
import type { VideoFilter, VideoFormat } from '../../types'

const { Text } = Typography

interface FilterPanelProps {
  filter: VideoFilter
  availableSources: string[]
  onFilterChange: (filter: Partial<VideoFilter>) => void
  onReset: () => void
}

const ALL_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'webm', 'flv', 'avi', 'hls', 'dash', 'blob']

export const FilterPanel: React.FC<FilterPanelProps> = ({ filter, availableSources, onFilterChange, onReset }) => {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <Collapse
      ghost
      activeKey={collapsed ? [] : ['filter']}
      onChange={() => setCollapsed(!collapsed)}
      items={[{
        key: 'filter',
        label: (
          <Space>
            <FilterOutlined />
            <Text strong>过滤</Text>
            <Text type="secondary">({availableSources.length} 个来源)</Text>
          </Space>
        ),
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>视频格式</Text>
              <Checkbox.Group
                options={ALL_FORMATS.map((f) => ({ label: f.toUpperCase(), value: f }))}
                value={filter.formats}
                onChange={(vals) => onFilterChange({ formats: vals as VideoFormat[] })}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>最低分辨率</Text>
              <Select value={filter.minResolution} onChange={(val) => onFilterChange({ minResolution: val })} style={{ width: '100%' }} size="small"
                options={[{ label: '不限', value: 'any' }, { label: '≥ 4K', value: '4k' }, { label: '≥ 1080p', value: '1080p' }, { label: '≥ 720p', value: '720p' }, { label: '≥ 480p', value: '480p' }, { label: '≥ 360p', value: '360p' }]} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>最小大小</Text>
              <Select value={filter.minSize} onChange={(val) => onFilterChange({ minSize: val })} style={{ width: '100%' }} size="small"
                options={[{ label: '不限', value: 'any' }, { label: '> 10MB', value: '10mb' }, { label: '> 50MB', value: '50mb' }, { label: '> 100MB', value: '100mb' }, { label: '> 500MB', value: '500mb' }]} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>最小时长</Text>
              <Select value={filter.minDuration} onChange={(val) => onFilterChange({ minDuration: val })} style={{ width: '100%' }} size="small"
                options={[{ label: '不限', value: 'any' }, { label: '> 1 分钟', value: '1min' }, { label: '> 5 分钟', value: '5min' }, { label: '> 10 分钟', value: '10min' }, { label: '> 30 分钟', value: '30min' }]} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>视频类型</Text>
              <Select value={filter.videoType} onChange={(val) => onFilterChange({ videoType: val })} style={{ width: '100%' }} size="small"
                options={[{ label: '全部', value: 'all' }, { label: '常规视频', value: 'regular' }, { label: '流媒体', value: 'streaming' }, { label: 'Blob', value: 'blob' }]} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>排序方式</Text>
              <Space>
                <Select value={filter.sortBy} onChange={(val) => onFilterChange({ sortBy: val })} style={{ width: 120 }} size="small"
                  options={[{ label: '检测时间', value: 'detectedAt' }, { label: '文件大小', value: 'size' }, { label: '分辨率', value: 'resolution' }, { label: '时长', value: 'duration' }]} />
                <Select value={filter.sortOrder} onChange={(val) => onFilterChange({ sortOrder: val })} style={{ width: 80 }} size="small"
                  options={[{ label: '降序', value: 'desc' }, { label: '升序', value: 'asc' }]} />
              </Space>
            </div>
            <Button size="small" icon={<UndoOutlined />} onClick={onReset}>重置过滤</Button>
          </div>
        ),
      }]}
    />
  )
}
