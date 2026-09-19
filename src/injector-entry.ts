/**
 * injector.js 打包入口（scripts/postbuild.mjs 用 esbuild 打包为 IIFE）
 *
 * 产物由 background 通过 chrome.scripting.executeScript({
 *   files: ['injector.js'], world: 'MAIN'
 * }) 注入页面，替代旧的 func: injectorMain 运行时序列化方案——
 * 那一方案要求 injectorMain 闭包自包含（不能 import），是此前
 * injector 与共享代码大面积重复的根因。
 */

import { injectorMain } from './utils/injector-script'

injectorMain()
