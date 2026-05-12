import React from 'react'
import { Form, Select, Switch, Radio, ColorPicker, InputNumber } from 'antd'
import { useSettingsStore } from '../../store/settings-store'
import type { ThemeMode, ListDensity } from '../../types'

export const AppearanceSettings: React.FC = () => {
  const { settings, updateSetting } = useSettingsStore()

  return (
    <Form layout="vertical" size="small">
      <Form.Item label="主题模式">
        <Select<ThemeMode> value={settings.themeMode} onChange={(val) => updateSetting('themeMode', val)}
          options={[{ label: '亮色', value: 'light' }, { label: '暗色', value: 'dark' }, { label: '跟随系统', value: 'system' }]} />
      </Form.Item>
      <Form.Item label="主题色">
        <ColorPicker value={settings.accentColor} onChange={(_, hex) => updateSetting('accentColor', hex)} />
      </Form.Item>
      <Form.Item label="语言">
        <Select value={settings.language} onChange={(val) => updateSetting('language', val)}
          options={[{ label: '中文', value: 'zh' }, { label: 'English', value: 'en' }]} />
      </Form.Item>
      <Form.Item label="Popup 宽度">
        <Radio.Group value={settings.popupWidth} onChange={(e) => updateSetting('popupWidth', e.target.value)}
          options={[{ label: '窄 (320px)', value: 320 }, { label: '标准 (400px)', value: 400 }, { label: '宽 (500px)', value: 500 }]} />
      </Form.Item>
      <Form.Item label="列表密度">
        <Select<ListDensity> value={settings.listDensity} onChange={(val) => updateSetting('listDensity', val)}
          options={[{ label: '紧凑', value: 'compact' }, { label: '标准', value: 'standard' }, { label: '详细', value: 'detailed' }]} />
      </Form.Item>
      <Form.Item label="下载完成通知">
        <Switch checked={settings.notifications} onChange={(val) => updateSetting('notifications', val)} />
      </Form.Item>
      <Form.Item label="自动清理天数（0 为不清理）">
        <InputNumber min={0} max={365} value={settings.autoCleanupDays} onChange={(val) => updateSetting('autoCleanupDays', val || 0)} />
      </Form.Item>
    </Form>
  )
}
