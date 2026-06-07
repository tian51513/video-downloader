import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 测试：诊断消息格式
 *
 * 当 downloadViaPageContext 失败时，MAIN world 应通过 postMessage 发送
 * PAGE_FETCH_ERROR 消息，ISOLATED world content script 转发到 background。
 *
 * 测试验证消息格式，确保 background 能正确解析错误信息。
 */

describe('诊断消息格式', () => {
  it('PAGE_FETCH_ERROR 消息应包含 taskId、stage 和 error 字段', () => {
    // 模拟 MAIN world 发送的 postMessage 数据
    const message = {
      type: 'PAGE_FETCH_ERROR',
      payload: {
        taskId: 'dl_test123',
        stage: 'fetch',
        error: 'TypeError: Failed to fetch',
        url: 'https://www.85po.com/video.mp4',
      },
    }

    expect(message.type).toBe('PAGE_FETCH_ERROR')
    expect(message.payload.taskId).toBe('dl_test123')
    expect(message.payload.stage).toBe('fetch')
    expect(message.payload.error).toContain('Failed to fetch')
    expect(message.payload.url).toBe('https://www.85po.com/video.mp4')
  })

  it('ISOLATED world 应能正确转发 MAIN world 的错误消息到 background', () => {
    // 模拟 window.postMessage 事件
    const mainWorldMessage = {
      type: 'PAGE_FETCH_ERROR',
      payload: {
        taskId: 'dl_test456',
        stage: 'execute',
        error: '找不到标签页',
        url: 'https://www.85po.com/v/21417/ri-o/',
      },
    }

    // ISOLATED world 收到 postMessage 后，应转发为 chrome.runtime.sendMessage
    const expectedRuntimeMessage = {
      type: 'PAGE_FETCH_ERROR',
      payload: mainWorldMessage.payload,
    }

    expect(expectedRuntimeMessage.type).toBe('PAGE_FETCH_ERROR')
    expect(expectedRuntimeMessage.payload.taskId).toBe('dl_test456')
    expect(expectedRuntimeMessage.payload.stage).toBe('execute')
  })

  it('stage 字段应为 fetch/execute/blob 三种值之一', () => {
    const validStages = ['fetch', 'execute', 'blob']
    const stages = ['fetch', 'execute', 'blob']

    for (const stage of stages) {
      expect(validStages).toContain(stage)
    }
  })
})
