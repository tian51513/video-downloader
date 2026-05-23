import React, { useEffect } from 'react'
import { ConfigProvider, theme, Typography, Tabs, Button } from 'antd'
import { UndoOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../store/settings-store'
import { DownloadSettingsPanel } from './components/DownloadSettings'
import { BlacklistManager } from './components/BlacklistManager'
import { NamingSettings } from './components/NamingSettings'
import { AppearanceSettings } from './components/AppearanceSettings'
import { ExternalDownloaderSettings } from './components/ExternalDownloaderSettings'
import { DownloadHistory } from './components/DownloadHistory'

const { Title } = Typography

function IndexOptions() {
  const { settings, loadSettings, resetSettings } = useSettingsStore()
  useEffect(() => { loadSettings() }, [loadSettings])

  const isDark = settings.themeMode === 'dark' || (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const tabItems = [
    { key: 'history', label: '下载历史', children: <DownloadHistory /> },
    { key: 'download', label: '下载设置', children: <DownloadSettingsPanel /> },
    { key: 'naming', label: '命名规则', children: <NamingSettings /> },
    { key: 'blacklist', label: '黑名单管理', children: <BlacklistManager /> },
    { key: 'downloader', label: '外部下载器', children: <ExternalDownloaderSettings /> },
    { key: 'appearance', label: '界面设置', children: <AppearanceSettings /> },
  ]

  return (
    <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: settings.accentColor } }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, background: isDark ? '#141414' : '#fff', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Title level={4} style={{ margin: 0 }}>视频下载器 - 设置</Title>
          <Button icon={<UndoOutlined />} onClick={resetSettings} size="small">恢复默认</Button>
        </div>
        <Tabs items={tabItems} />
      </div>
    </ConfigProvider>
  )
}

export default IndexOptions
