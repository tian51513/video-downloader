import React from 'react'
import { Button, Space, Select, Typography } from 'antd'
import { DownloadOutlined, ClearOutlined } from '@ant-design/icons'
import type { DownloaderType } from '../../types'

const { Text } = Typography

interface BatchActionsProps {
  selectedCount: number
  totalCount: number
  onDownloadSelected: () => void
  onDownloadAll: () => void
  onClear: () => void
  downloader: DownloaderType
  onDownloaderChange: (downloader: DownloaderType) => void
}

export const BatchActions: React.FC<BatchActionsProps> = ({
  selectedCount, totalCount, onDownloadSelected, onDownloadAll, onClear, downloader, onDownloaderChange,
}) => {
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Space>
        <Select<DownloaderType> value={downloader} onChange={onDownloaderChange} size="small" style={{ width: 100 }}
          options={[{ label: '浏览器', value: 'chrome' }, { label: 'IDM', value: 'idm' }, { label: 'aria2', value: 'aria2' }, { label: 'Motrix', value: 'motrix' }]} />
        <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={onDownloadSelected} disabled={selectedCount === 0}>
          下载选中 ({selectedCount})
        </Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={onDownloadAll} disabled={totalCount === 0}>全部下载</Button>
      </Space>
      <Space>
        <Text type="secondary" style={{ fontSize: 12 }}>{selectedCount}/{totalCount}</Text>
        <Button size="small" icon={<ClearOutlined />} onClick={onClear} title="清空列表" />
      </Space>
    </div>
  )
}
