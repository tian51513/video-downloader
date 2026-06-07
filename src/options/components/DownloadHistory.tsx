import React, { useEffect, useState, useCallback } from 'react'
import { Table, Tag, Button, Space, Progress, Popconfirm, Tabs, Empty, Typography, Tooltip, message, Dropdown } from 'antd'
import {
  PlayCircleOutlined,
  FolderOpenOutlined,
  RedoOutlined,
  DeleteOutlined,
  ClearOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  RetweetOutlined,
} from '@ant-design/icons'
import type { DownloadTask, DownloadStatus } from '../../types'
import { formatFileSize, formatDuration, formatSpeed, getResolutionLabel } from '../../utils/format'

const { Text } = Typography

const statusConfig: Record<string, { text: string; color: string }> = {
  pending: { text: '等待中', color: 'default' },
  downloading: { text: '下载中', color: 'processing' },
  merging: { text: '合并中', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
  failed: { text: '失败', color: 'error' },
  paused: { text: '已暂停', color: 'warning' },
}

export const DownloadHistory: React.FC = () => {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [activeTab, setActiveTab] = useState('all')

  const loadTasks = useCallback(async () => {
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOADS' }, (response) => {
      if (response?.tasks) setTasks(response.tasks)
    })
  }, [])

  useEffect(() => {
    loadTasks()
    // 每 2 秒刷新一次（获取进度更新）
    const timer = setInterval(loadTasks, 2000)
    return () => clearInterval(timer)
  }, [loadTasks])

  // 监听实时进度
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'DOWNLOAD_PROGRESS') {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === message.payload.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = message.payload
            return next
          }
          return [...prev, message.payload]
        })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handlePlay = (task: DownloadTask) => {
    if (task.chromeDownloadId) {
      chrome.downloads.open(task.chromeDownloadId)
    } else {
      // 没有 chromeDownloadId 时，尝试通过文件名在默认下载目录查找
      if (task.savedFileName) {
        // 无法定位文件路径，提示用户
        message.warning('该文件通过另存为保存，请手动找到文件播放')
      }
    }
  }

  const handleShowFolder = (task: DownloadTask) => {
    if (task.chromeDownloadId) {
      chrome.downloads.show(task.chromeDownloadId)
    } else {
      if (task.savedFileName) {
        message.warning('该文件通过另存为保存，请手动打开文件夹')
      }
    }
  }

  const handleRetryCurrent = (task: DownloadTask) => {
    chrome.runtime.sendMessage({ type: 'RETRY_DOWNLOAD', payload: { taskId: task.id } })
  }

  const handleRetryNew = (task: DownloadTask) => {
    chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      payload: { video: task.video, downloader: task.downloader },
    })
  }

  const handleCancel = (taskId: string) => {
    chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD', payload: { taskId } })
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  const handlePause = (taskId: string) => {
    chrome.runtime.sendMessage({ type: 'PAUSE_DOWNLOAD', payload: { taskId } })
  }

  const handleClearAll = () => {
    // 取消活跃下载
    tasks.forEach((t) => {
      if (t.status === 'downloading' || t.status === 'merging' || t.status === 'paused') {
        chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD', payload: { taskId: t.id } })
      }
    })
    chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_DOWNLOADS' }, () => {
      setTasks([])
      loadTasks()
    })
  }

  const handleClearCompleted = () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_DOWNLOADS' }, () => {
      loadTasks()
    })
  }

  const filteredTasks = tasks.filter((t) => {
    if (activeTab === 'downloading') return t.status === 'downloading' || t.status === 'merging' || t.status === 'paused'
    if (activeTab === 'completed') return t.status === 'completed'
    if (activeTab === 'failed') return t.status === 'failed'
    return true
  })

  // 按时间倒序
  filteredTasks.sort((a, b) => (b.startedAt || b.detectedAt || 0) - (a.startedAt || a.detectedAt || 0))

  const formatTime = (ts?: number) => {
    if (!ts) return '-'
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  }

  const columns = [
    {
      title: '文件名',
      dataIndex: ['video', 'title'],
      key: 'title',
      width: 200,
      ellipsis: true,
      render: (title: string, record: DownloadTask) => (
        <Tooltip title={title || '未命名视频'}>
          <span>{title || '未命名视频'}</span>
        </Tooltip>
      ),
    },
    {
      title: '格式',
      dataIndex: ['video', 'format'],
      key: 'format',
      width: 100,
      render: (fmt: string, record: DownloadTask) => (
        <Space size={4}>
          <Tag>{fmt?.toUpperCase()}</Tag>
          {record.video.height && (
            <Text type="secondary" style={{ fontSize: 11 }}>{getResolutionLabel(record.video.width, record.video.height)}</Text>
          )}
        </Space>
      ),
    },
    {
      title: '大小',
      key: 'size',
      width: 90,
      render: (_: any, record: DownloadTask) => {
        const size = record.totalBytes > 0 ? record.totalBytes : record.downloadedBytes
        if (!size) return <Text type="secondary">-</Text>
        return <Text type="secondary">{formatFileSize(size)}</Text>
      },
    },
    {
      title: '来源',
      dataIndex: ['video', 'domain'],
      key: 'domain',
      width: 120,
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: DownloadStatus, record: DownloadTask) => {
        const cfg = statusConfig[status]
        if (status === 'failed' && record.error) {
          return (
            <Tooltip title={record.error}>
              <Tag color={cfg.color}>{cfg.text}</Tag>
            </Tooltip>
          )
        }
        return cfg ? <Tag color={cfg.color}>{cfg.text}</Tag> : status
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 160,
      render: (_: any, record: DownloadTask) => {
        const isActive = record.status === 'downloading' || record.status === 'merging'
        if (isActive) {
          return (
            <div>
              <Progress percent={Math.round(record.progress)} size="small" />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {record.totalBytes > 0
                  ? `${formatFileSize(record.downloadedBytes)} / ${formatFileSize(record.totalBytes)}`
                  : formatFileSize(record.downloadedBytes)}
                {record.speed > 0 && ` · ${formatSpeed(record.speed)}`}
              </Text>
            </div>
          )
        }
        if (record.status === 'paused') {
          return (
            <div>
              <Progress percent={Math.round(record.progress)} size="small" status="exception" />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {record.totalBytes > 0
                  ? `${formatFileSize(record.downloadedBytes)} / ${formatFileSize(record.totalBytes)}`
                  : formatFileSize(record.downloadedBytes)}
              </Text>
            </div>
          )
        }
        if (record.status === 'completed') {
          return (
            <Text type="success">
              {record.totalBytes > 0 ? formatFileSize(record.totalBytes) : formatFileSize(record.downloadedBytes)}
            </Text>
          )
        }
        return <Text type="secondary">-</Text>
      },
    },
    {
      title: '时间',
      dataIndex: 'completedAt',
      key: 'time',
      width: 150,
      render: (_: any, record: DownloadTask) => formatTime(record.completedAt || record.startedAt),
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      key: 'error',
      width: 200,
      ellipsis: true,
      render: (error: string) => {
        if (!error) return '-'
        return (
          <Tooltip title={error}>
            <Text type="danger" style={{ fontSize: 12 }}>{error}</Text>
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: any, record: DownloadTask) => {
        const isActive = record.status === 'downloading' || record.status === 'merging'
        return (
          <Space size={2}>
            {record.status === 'completed' && (
              <>
                <Tooltip title="播放">
                  <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => handlePlay(record)} />
                </Tooltip>
                <Tooltip title="打开文件夹">
                  <Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={() => handleShowFolder(record)} />
                </Tooltip>
              </>
            )}
            {isActive && (
              <Tooltip title="暂停">
                <Button type="text" size="small" icon={<PauseCircleOutlined />} onClick={() => handlePause(record.id)} />
              </Tooltip>
            )}
            {(record.status === 'failed' || record.status === 'paused') && (
              <Dropdown
                menu={{
                  items: [
                    { key: 'retry-current', icon: <RetweetOutlined />, label: '重试当前任务' },
                    { key: 'retry-new', icon: <PlusOutlined />, label: '新建下载任务' },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'retry-current') handleRetryCurrent(record)
                    else handleRetryNew(record)
                  },
                }}
              >
                <Tooltip title="重试">
                  <Button type="text" size="small" icon={<RedoOutlined />} />
                </Tooltip>
              </Dropdown>
            )}
            {record.status !== 'completed' && (
              <Popconfirm title="确定删除？" onConfirm={() => handleCancel(record.id)} okText="确定" cancelText="取消">
                <Tooltip title="删除">
                  <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
  ]

  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const failedCount = tasks.filter((t) => t.status === 'failed').length
  const activeCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'merging').length

  const tabItems = [
    { key: 'all', label: `全部 (${tasks.length})` },
    { key: 'downloading', label: activeCount > 0 ? `下载中 (${activeCount})` : '下载中' },
    { key: 'completed', label: `已完成 (${completedCount})` },
    { key: 'failed', label: failedCount > 0 ? `失败 (${failedCount})` : '失败' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="small"
          style={{ marginBottom: 0, marginTop: -4 }}
        />
        {tasks.length > 0 && (
          <Space size={4}>
            {completedCount > 0 && (
              <Popconfirm
                title={`确定清除 ${completedCount} 条已完成记录？`}
                onConfirm={handleClearCompleted}
                okText="确定"
                cancelText="取消"
              >
                <Button size="small" icon={<ClearOutlined />}>清除已完成</Button>
              </Popconfirm>
            )}
            <Popconfirm
              title={`确定清空全部 ${tasks.length} 条记录？`}
              description="下载中的任务也会被取消"
              onConfirm={handleClearAll}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" danger>清空列表</Button>
            </Popconfirm>
          </Space>
        )}
      </div>

      {filteredTasks.length === 0 ? (
        <Empty description={activeTab === 'all' ? '暂无下载记录' : `暂无${statusConfig[activeTab]?.text || ''}记录`} />
      ) : (
        <Table
          dataSource={filteredTasks}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20, size: 'small', showTotal: (total) => `共 ${total} 条` }}
          scroll={{ y: 500 }}
        />
      )}
    </div>
  )
}
