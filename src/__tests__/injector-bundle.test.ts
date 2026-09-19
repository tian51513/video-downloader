import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 构建产物冒烟测试：injector.js（scripts/postbuild.mjs 的 esbuild 产物）
 *
 * injector 改为"构建期打包 + files 注入"后，打包管线本身成了风险点
 * （入口改动、依赖引入 chrome.*、IIFE 包装失效都会让注入静默失败）。
 * 此处在 jsdom 中执行真实产物，守住最基本的可运行性。
 *
 * 未构建（无 build/ 目录）时跳过，不阻塞纯逻辑测试。
 */

const bundlePath = resolve(__dirname, '../../build/chrome-mv3-prod/injector.js')
const bundleExists = existsSync(bundlePath)

describe.runIf(bundleExists)('injector.js 构建产物冒烟', () => {
  it('在 jsdom 中执行成功：注入标记置位、XHR/Fetch 已被包装、重复执行幂等', () => {
    const source = readFileSync(bundlePath, 'utf-8')

    const win = window as any
    // 清理可能的残留（同文件内多次执行）
    delete win.__VIDEO_DOWNLOADER_INJECTED__
    const fetchBefore = win.fetch
    // injector 以原型打补丁方式 hook XHR（构造器引用不变，原型方法被替换）
    const xhrOpenBefore = XMLHttpRequest.prototype.open

    // 执行 IIFE 产物（injectorMain 会在顶层立即调用）。
    // 信任边界：source 是本仓库 scripts/postbuild.mjs 的本地构建产物，
    // 非任何外部输入——执行构建产物正是本冒烟测试的目的
    expect(() => new Function(source)()).not.toThrow()

    expect(win.__VIDEO_DOWNLOADER_INJECTED__).toBe(true)
    // 网络监听 hook 已安装
    expect(win.fetch).not.toBe(fetchBefore)
    expect(XMLHttpRequest.prototype.open).not.toBe(xhrOpenBefore)

    // 幂等：重复执行不报错、不再重复包装
    const fetchOnceHooked = win.fetch
    expect(() => new Function(source)()).not.toThrow()
    expect(win.fetch).toBe(fetchOnceHooked)
  })
})
