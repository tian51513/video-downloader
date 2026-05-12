import React from 'react'
import { Form, Input } from 'antd'
import { useSettingsStore } from '../../store/settings-store'

export const ExternalDownloaderSettings: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const config = settings.externalDownloaderConfig

  const updateConfig = (key: string, value: string) => updateSetting('externalDownloaderConfig', { ...config, [key]: value })

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="aria2 RPC 地址">
        <Input value={config.aria2RpcUrl} onChange={(e) => updateConfig('aria2RpcUrl', e.target.value)} placeholder="http://localhost:6800/jsonrpc" />
      </Form.Item>
      <Form.Item label="aria2 RPC 密钥">
        <Input.Password value={config.aria2RpcSecret} onChange={(e) => updateConfig('aria2RpcSecret', e.target.value)} placeholder="留空表示无密钥" />
      </Form.Item>
      <Form.Item label="IDM 路径（可选）">
        <Input value={config.idmPath} onChange={(e) => updateConfig('idmPath', e.target.value)} placeholder="C:\Program Files\Internet Download Manager\IDMan.exe" />
      </Form.Item>
      <Form.Item label="自定义命令（可选）">
        <Input value={config.customCommand} onChange={(e) => updateConfig('customCommand', e.target.value)} placeholder="如: curl" />
      </Form.Item>
      <Form.Item label="自定义命令参数">
        <Input value={config.customCommandArgs} onChange={(e) => updateConfig('customCommandArgs', e.target.value)} placeholder="如: -o {filename} {url}" />
      </Form.Item>
    </Form>
  )
}
