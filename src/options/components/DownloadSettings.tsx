import React, { useEffect, useState, useCallback } from 'react'
import { Form, InputNumber, Switch, Select, Button, Space, message } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../../store/settings-store'
import { saveDirectoryHandle } from '../../utils/directory-handle'
import type { DownloaderType } from '../../types'

export const DownloadSettingsPanel: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()
  const ds = settings.downloadSettings
  const [isPickDirSupported, setIsPickDirSupported] = useState(false)
  const [dirName, setDirName] = useState(settings.baseSaveDirectory || '')

  useEffect(() => {
    setIsPickDirSupported('showDirectoryPicker' in window)
  }, [])

  const handlePickDirectory = useCallback(async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
      if (dirHandle?.name) {
        // 保存目录句柄到 IndexedDB（供 Service Worker 和 save-helper 使用）
        try {
          await saveDirectoryHandle('download-directory', dirHandle)
        } catch (saveErr: any) {
          console.warn('[DownloadSettings] 保存目录句柄失败:', saveErr.message)
        }
        const path = dirHandle.name
        updateSetting('baseSaveDirectory', path)
        setDirName(path)
        message.success(`已选择: ${path}`)
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        message.error('选择目录失败')
      }
    }
  }, [updateSetting])

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="默认下载器">
        <Select<DownloaderType> value={settings.defaultDownloader} onChange={(val) => updateSetting('defaultDownloader', val)}
          options={[{ label: '浏览器内置', value: 'chrome' }, { label: 'IDM', value: 'idm' }, { label: 'aria2', value: 'aria2' }, { label: 'Motrix', value: 'motrix' }, { label: '自定义', value: 'custom' }]} />
      </Form.Item>
      <Form.Item label="保存目录">
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item style={{ flex: 1, marginBottom: 0 }}>
            <span>{dirName || '未设置（浏览器默认）'}</span>
          </Form.Item>
          {isPickDirSupported && (
            <Button icon={<FolderOpenOutlined />} onClick={handlePickDirectory} title="选择目录">选择</Button>
          )}
          {dirName && (
            <Button onClick={() => { updateSetting('baseSaveDirectory', ''); setDirName('') }} type="text" danger size="small">清除</Button>
          )}
        </Space.Compact>
      </Form.Item>
      <Form.Item label="另存为（每次下载弹出对话框）">
        <Switch checked={ds.askSaveLocation || false} onChange={(val) => updateSetting('downloadSettings', { ...ds, askSaveLocation: val })} />
      </Form.Item>
      <Form.Item label="最大并发下载数">
        <InputNumber min={1} max={10} value={ds.maxConcurrent} onChange={(val) => updateSetting('downloadSettings', { ...ds, maxConcurrent: val || 3 })} />
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
