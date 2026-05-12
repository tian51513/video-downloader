import React, { useState } from 'react'
import { Input, Select, Switch, Button, Space, Table, Popconfirm, Typography } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../../store/settings-store'
import type { BlacklistRule, BlacklistMatchType } from '../../types'

const { Text } = Typography

export const BlacklistManager: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const [newPattern, setNewPattern] = useState('')
  const [newType, setNewType] = useState<BlacklistMatchType>('domain')

  const addRule = () => {
    if (!newPattern.trim()) return
    const rule: BlacklistRule = { id: `bl_${Date.now()}`, pattern: newPattern.trim(), type: newType, reason: '', enabled: true }
    updateSetting('blacklist', [...settings.blacklist, rule])
    setNewPattern('')
  }

  const removeRule = (id: string) => updateSetting('blacklist', settings.blacklist.filter((r) => r.id !== id))
  const toggleRule = (id: string) => updateSetting('blacklist', settings.blacklist.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r))

  const columns = [
    { title: '状态', dataIndex: 'enabled', width: 60, render: (enabled: boolean, record: BlacklistRule) => <Switch size="small" checked={enabled} onChange={() => toggleRule(record.id)} /> },
    { title: '类型', dataIndex: 'type', width: 80, render: (type: string) => <Text type="secondary">{type}</Text> },
    { title: '匹配规则', dataIndex: 'pattern', ellipsis: true },
    { title: '备注', dataIndex: 'reason', width: 120, render: (reason?: string) => <Text type="secondary">{reason || '-'}</Text> },
    { title: '操作', width: 60, render: (_: any, record: BlacklistRule) => (
      <Popconfirm title="确定删除？" onConfirm={() => removeRule(record.id)}>
        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    ) },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input placeholder="输入匹配规则" value={newPattern} onChange={(e) => setNewPattern(e.target.value)} onPressEnter={addRule} style={{ width: 200 }} />
        <Select value={newType} onChange={setNewType} style={{ width: 100 }} size="small"
          options={[{ label: '域名', value: 'domain' }, { label: 'URL', value: 'url' }, { label: '正则', value: 'regex' }]} />
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addRule}>添加</Button>
      </Space>
      <Table dataSource={settings.blacklist} columns={columns} rowKey="id" size="small" pagination={false} />
    </div>
  )
}
