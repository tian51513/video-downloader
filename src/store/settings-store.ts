import { create } from 'zustand'
import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { getSettings, updateSettings, SETTINGS_KEY } from '../utils/storage'

interface SettingsState {
  settings: AppSettings
  isLoaded: boolean
  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  resetSettings: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  isLoaded: false,

  loadSettings: async () => {
    const settings = await getSettings()
    set({ settings, isLoaded: true })
  },

  updateSetting: async (key, value) => {
    const prev = useSettingsStore.getState().settings
    // 乐观更新，写入失败回滚（此前 fire-and-forget，失败后 UI 与存储永久不一致）
    set({ settings: { ...prev, [key]: value } })
    try {
      await updateSettings({ [key]: value })
    } catch {
      set({ settings: prev })
    }
  },

  resetSettings: async () => {
    set({ settings: { ...DEFAULT_SETTINGS } })
    try {
      await updateSettings(DEFAULT_SETTINGS)
    } catch {
      const settings = await getSettings()
      set({ settings })
    }
  },
}))

// 跨页面同步：任一上下文（options/popup/sidepanel/background）更新设置后，
// 所有已打开页面立即刷新——此前各持一份 Zustand 副本直到重开
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return
    const stored = (changes[SETTINGS_KEY].newValue ?? {}) as Partial<AppSettings>
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ...stored } })
  })
}
