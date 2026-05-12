import { create } from 'zustand'
import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { getSettings, updateSettings } from '../utils/storage'

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
    set((state) => {
      const newSettings = { ...state.settings, [key]: value }
      updateSettings({ [key]: value })
      return { settings: newSettings }
    })
  },

  resetSettings: async () => {
    set({ settings: { ...DEFAULT_SETTINGS } })
    await updateSettings(DEFAULT_SETTINGS)
  },
}))