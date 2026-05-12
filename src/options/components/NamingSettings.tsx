import React from 'react'
import { Form, Input, Typography, Space } from 'antd'
import { useSettingsStore } from '../../store/settings-store'

const { Text } = Typography

export const NamingSettings: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="文件命名模板">
        <Input value={settings.namingTemplate} onChange={(e) => updateSetting('namingTemplate', e.target.value)} placeholder="{name}.{format}" />
        <Space style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>可用变量:</Text>
          {['{name}', '{domain}', '{date}', '{resolution}', '{format}'].map((v) => (
            <Text key={v} code style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => updateSetting('namingTemplate', settings.namingTemplate + v)}>{v}</Text>
          ))}
        </Space>
      </Form.Item>
      <Form.Item label="预览">
        <Text code style={{ fontSize: 12 }}>示例: 斗罗大陆_第120集.mp4</Text>
      </Form.Item>
    </Form>
  )
}
