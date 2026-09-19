import { useCallback, useEffect, useState } from 'react'
import { Modal, message } from 'antd'
import { useVideoStore } from '../store/video-store'
import { useSettingsStore } from '../store/settings-store'
import { useDownloadStore } from '../store/download-store'
import type { DetectedVideo, DownloaderType, DownloadTask, ExtensionMessage } from '../types'

/**
 * UI（popup / sidepanel）与 background 的编排桥
 *
 * 此前两个入口各复制约 100 行：初始化三连（GET_DOWNLOADS / GET_VIDEOS /
 * loadSettings）、onMessage 监听合并、四个下载操作、六个清除操作——且已
 * 出现行为分叉（取消语义、孤儿清理范围）。收敛为单一实现：
 * - 取消 = CANCEL_DOWNLOAD（保留任务记录，可重试）；不做本地 removeTask
 * - 孤儿清理 = 同时清视频缓存与下载任务（popup 的完整版）
 */

export function useExtensionBridge() {
  const { settings, loadSettings } = useSettingsStore()
  const { tasks, addTask, clearOrphanedTasks, clearPageTasks } = useDownloadStore()
  const { setVideos, clearVideos, clearOrphanedVideos, clearVideosByUrls } = useVideoStore()
  const [currentTab, setCurrentTab] = useState('')

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // 初始拉取：下载任务 + 全部视频 + 当前标签页
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOADS' }, (response) => {
      if (response?.tasks) {
        for (const t of response.tasks) addTask(t)
      }
    })
    chrome.runtime.sendMessage({ type: 'GET_VIDEOS' }, (response) => {
      if (response?.videos) setVideos(response.videos)
    })
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setCurrentTab(tabs[0].url)
    })
  }, [addTask, setVideos])

  // 推送监听：VIDEO_DETECTED 按页面合并、DOWNLOAD_PROGRESS 覆盖任务
  useEffect(() => {
    const listener = (msg: ExtensionMessage) => {
      if (msg.type === 'VIDEO_DETECTED' && msg.payload?.videos) {
        const store = useVideoStore.getState()
        const pageUrl = msg.payload.pageUrl
        const merged = [...store.videos.filter((v) => v.pageUrl !== pageUrl), ...msg.payload.videos]
        store.setVideos(merged)
      } else if (msg.type === 'DOWNLOAD_PROGRESS') {
        addTask(msg.payload as DownloadTask)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [addTask])

  // ===== 下载操作 =====

  const handleDownload = useCallback((video: DetectedVideo, downloader: DownloaderType) => {
    chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', payload: { video, downloader } })
  }, [])

  const handlePause = useCallback((taskId: string) => {
    chrome.runtime.sendMessage({ type: 'PAUSE_DOWNLOAD', payload: { taskId } })
  }, [])

  const handleCancel = useCallback((taskId: string) => {
    chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD', payload: { taskId } }).catch(() => {})
  }, [])

  const handleRetry = useCallback((taskId: string) => {
    chrome.runtime.sendMessage({ type: 'RETRY_DOWNLOAD', payload: { taskId } })
  }, [])

  // ===== 清除操作 =====

  const clearAllVideos = useCallback(() => {
    Modal.confirm({
      title: '确定清除所有已检测的视频？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        clearVideos()
        chrome.runtime.sendMessage({ type: 'CLEAR_ALL_VIDEOS' }).catch(() => {})
        // 触发所有标签页重新检测视频
        chrome.runtime.sendMessage({ type: 'RESCAN_ALL_TABS' }).catch(() => {})
        message.success('已清除所有检测视频，正在重新检测...')
      },
    })
  }, [clearVideos])

  const clearCurrentPageDownloads = useCallback(() => {
    Modal.confirm({
      title: '确定清除当前页面的下载记录？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        clearPageTasks(currentTab)
        chrome.runtime.sendMessage({ type: 'CLEAR_PAGE_DOWNLOADS', payload: { pageUrl: currentTab } }).catch(() => {})
        message.success('已清除当前页面的下载记录')
      },
    })
  }, [currentTab, clearPageTasks])

  const clearCompleted = useCallback(() => {
    useDownloadStore.getState().clearCompleted()
    chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_DOWNLOADS' }).catch(() => {})
    message.success('已清除完成记录')
  }, [])

  const clearCompletedFull = useCallback(() => {
    const urlsToRemove = useDownloadStore
      .getState()
      .tasks.filter((t) => t.status === 'completed')
      .map((t) => t.video.url)

    useDownloadStore.getState().clearCompletedFull()
    clearVideosByUrls(urlsToRemove)
    chrome.runtime.sendMessage({ type: 'CLEAR_COMPLETED_FULL_DOWNLOADS' }).catch(() => {})
    chrome.runtime.sendMessage({ type: 'CLEAR_VIDEOS_BY_URLS', payload: { urls: urlsToRemove } }).catch(() => {})
    message.success('已清除完成记录（含同名版本）')
  }, [clearVideosByUrls])

  const clearFailed = useCallback(() => {
    useDownloadStore.getState().clearFailed()
    chrome.runtime.sendMessage({ type: 'CLEAR_FAILED_DOWNLOADS' }).catch(() => {})
    message.success('已清除失败记录')
  }, [])

  const clearOrphaned = useCallback(async () => {
    const tabs = await chrome.tabs.query({})
    const openUrls = tabs.map((t) => t.url || '').filter(Boolean)
    clearOrphanedVideos(openUrls)
    clearOrphanedTasks(openUrls)
    chrome.runtime.sendMessage({ type: 'CLEAR_ORPHANED_VIDEOS', payload: { openPageUrls: openUrls } }).catch(() => {})
    chrome.runtime.sendMessage({ type: 'CLEAR_ORPHANED_DOWNLOADS', payload: { openPageUrls: openUrls } }).catch(() => {})
    message.success('已清除已关闭页面的视频与下载')
  }, [clearOrphanedVideos, clearOrphanedTasks])

  // ===== 派生值 =====

  const downloadingCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'merging').length

  const isDark =
    settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return {
    currentTab,
    tasks,
    handleDownload,
    handlePause,
    handleCancel,
    handleRetry,
    clearAllVideos,
    clearCurrentPageDownloads,
    clearCompleted,
    clearCompletedFull,
    clearFailed,
    clearOrphaned,
    downloadingCount,
    isDark,
  }
}
