import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { getSettings, updateSettings } from '../utils/storage'

export async function getFullSettings(): Promise<AppSettings> {
  return await getSettings()
}

export async function patchSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  await updateSettings(partial)
  return await getSettings()
}

export async function resetToDefaults(): Promise<AppSettings> {
  await updateSettings(DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS }
}

export async function initDefaultSettings(): Promise<void> {
  const current = await getSettings()
  if (!current || Object.keys(current).length === 0) {
    await chrome.storage.local.set({
      'app-settings': DEFAULT_SETTINGS,
    })
  }
}
