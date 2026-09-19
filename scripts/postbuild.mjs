/**
 * Plasmo 构建后处理：
 * 1. 拷贝不经 TS 编译的静态扩展页面（offscreen / save-helper）
 * 2. 用 esbuild 把 injector 打包为自包含 IIFE（injector.js），
 *    供 chrome.scripting.executeScript({ files }) 注入 MAIN world
 */

import { copyFileSync, mkdirSync } from 'node:fs'
import { build } from 'esbuild'

const target = process.argv[2] || 'chrome-mv3-prod'
const outDir = `build/${target}`

// copyFileSync 不会自动创建目标目录（dev 模式下 build/ 可能尚未生成）
mkdirSync(outDir, { recursive: true })

for (const f of [
  'assets/offscreen.html',
  'assets/offscreen.js',
  'assets/save-helper.html',
  'assets/save-helper.js',
]) {
  try {
    copyFileSync(f, `${outDir}/${f.split('/').pop()}`)
  } catch (e) {
    console.error('Copy failed:', f, e.message)
  }
}

await build({
  entryPoints: ['src/injector-entry.ts'],
  bundle: true,
  format: 'iife',
  outfile: `${outDir}/injector.js`,
  target: 'chrome120',
  minify: true,
  logLevel: 'info',
})

console.log(`[postbuild] ${outDir}/injector.js + 静态资源已就绪`)
