import React from 'react'
import { Form, InputNumber, Switch, Select } from 'antd'
import { useSettingsStore } from '../../store/settings-store'
import type { DownloaderType } from '../../types'

export const DownloadSettingsPanel: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const ds = settings.downloadSettings

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="默认下载器">
        <Select<DownloaderType> value={settings.defaultDownloader} onChange={(val) => updateSetting('defaultDownloader', val)}
          options={[{ label: '浏览器内置', value: 'chrome' }, { label: 'IDM', value: 'idm' }, { label: 'aria2', value: 'aria2' }, { label: 'Motrix', value: 'motrix' }, { label: '自定义', value: 'custom' }]} />
      </Form.Item>
      <Form.Item label="最大并发下载数">
        <InputNumber min={1} max={5} value={ds.maxConcurrent} onChange={(val) => updateSetting('downloadSettings', { ...ds, maxConcurrent: val || 3 })} />
      </Form.Item>
      <Form.Item label="失败重试次数">
        <InputNumber min={0} max={10} value={ds.retryCount} onChange={(val) => updateSetting('downloadSettings', { ...ds, retryCount: val || 3 })} />
      </Form.Item>
      <Form.Item label="重试间隔（毫秒）">
        <InputNumber min={500} max={30000} step={500} value={ds.retryDelay} onChange={(val) => updateSetting('downloadSettings', { ...ds, retryDelay: val || 1000 })} />
      </Form.Item>
      <Form.Item label="请求超时（毫秒）">
        <InputNumber min={5000} max={120000} step={5000} value={ds.timeout} onChange={(val) => updateSetting('downloadSettings', { ...ds, timeout: val || 30000 })} />
      </Form.Item>
      <Form.Item label="按域名分类保存">
        <Switch checked={settings.saveByDomain} onChange={(val) => updateSetting('saveByDomain', val)} />
      </Form.Item>
    </Form>
  )
}
