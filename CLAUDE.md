# Video Downloader - Chrome Extension

Chrome MV3 扩展，用于检测网页视频/音频并下载。支持 MP4/MKV/WebM/HLS/DASH/MP3/M4A/AAC/FLAC/OGG 等格式。

## 技术栈

- **框架**: Plasmo 0.90.x (Chrome Extension 开发框架)
- **语言**: TypeScript 5.6
- **UI**: React 18 + Ant Design 5 + @ant-design/icons
- **状态管理**: Zustand 5
- **视频处理**: mux.js 6 (TS→MP4 转封装), hls.js, dashjs
- **构建**: pnpm + Plasmo 内置 (SWC + ESBuild)
- **测试**: Vitest 4 + @testing-library/react + jsdom
- **目标**: Chrome MV3 (chrome-mv3-prod)

## 构建命令

```bash
pnpm dev          # 开发模式 (热重载)
pnpm build        # 生产构建 (自动复制 assets/*.html, assets/*.js 到 build/)
pnpm clean        # 清理构建产物
pnpm test         # 运行测试
pnpm test:watch   # 测试监视模式
```

构建脚本会将 `assets/` 下的静态文件（offscreen.html/js, save-helper.html/js）复制到 `build/chrome-mv3-prod/`。

## 项目架构

```
src/
├── __tests__/           # Vitest 单元测试
│   ├── setup.ts
│   ├── download-strategy.test.ts      # 下载策略测试
│   ├── download-diagnostic.test.ts    # 下载诊断测试
│   ├── download-dedup.test.ts         # 去重测试
│   ├── download-progress-monotonic.test.ts  # 进度单调性测试
│   ├── download-layer-fallback.test.ts      # 多层级降级测试
│   ├── download-filename.test.ts      # 文件名测试
│   ├── download-rules.test.ts         # 下载规则测试
│   ├── injector-m3u8-parser.test.ts   # MAIN world m3u8 解析测试
│   ├── VideoItem-version-panel.test.ts  # VideoItem 版本面板测试
│   └── SidePanel-download-state.test.ts  # SidePanel 下载状态测试
├── background/          # Service Worker (扩展核心)
│   ├── index.ts         # 消息路由、context menu、tab 事件、keepalive alarm、MAIN world 脚本注入
│   ├── download-manager.ts  # 下载队列、多层级降级下载、并发控制、进度追踪
│   ├── hls-downloader.ts    # HLS 下载编排 (m3u8→分片下载→解密→mux.js转封装→保存)
│   ├── hls-parser.ts        # m3u8 解析 (master/media playlist, #EXT-X-MAP, #EXT-X-KEY)
│   └── settings.ts          # 设置读写 (chrome.storage)
├── content/             # Content Script — MAIN world (Plasmo CS, 主要检测路径)
│   ├── index.ts              # 入口 (PlasmoCSConfig: MAIN world, run_at: document_start)
│   ├── network-interceptor.ts  # Hook XHR/Fetch，检测视频/音频请求
│   ├── dom-observer.ts        # MutationObserver 扫描 DOM video/source/iframe
│   ├── blob-handler.ts        # Hook URL.createObjectURL 捕获 Blob URL
│   ├── hls-parser.ts          # MAIN world 内联 m3u8 解析
│   ├── dash-parser.ts         # DASH MPD 解析
│   └── name-detector.ts       # 视频标题检测 (title/og:title/h1/附近文本)
├── contents/            # Content Script — ISOLATED world (Plasmo CS, 消息中转)
│   └── detector.ts      # 接收 injector-script postMessage，转发下载进度/错误，处理 DETECT_NOW 重扫描
├── popup/               # 弹出窗口 UI
│   ├── index.tsx
│   └── components/
│       ├── VideoList.tsx   # 视频列表 + 下载状态面板切换
│       └── VideoItem.tsx   # 视频项卡片、版本面板展开、下载进度/暂停/取消
├── sidepanel/           # 侧边栏 UI (详细视图)
│   ├── index.tsx
│   └── components/
│       ├── FilterPanel.tsx
│       ├── BatchActions.tsx
│       └── PreviewPlayer.tsx
├── options/             # 设置页 UI
│   ├── index.tsx
│   └── components/
│       ├── DownloadSettings.tsx      # 下载设置 (并发、重试、超时、另存为、目录选择)
│       ├── DownloadHistory.tsx       # 下载历史 (表格、进度、重试、清除)
│       ├── BlacklistManager.tsx
│       ├── NamingSettings.tsx
│       ├── AppearanceSettings.tsx
│       └── ExternalDownloaderSettings.tsx
├── tabs/
│   └── preview/         # 视频预览播放器
│       ├── index.tsx
│       └── components/
│           └── FullPlayer.tsx   # 完整视频播放器
├── store/
│   ├── video-store.ts   # 视频列表 Zustand store
│   ├── download-store.ts # 下载状态 Zustand store
│   └── settings-store.ts # 设置 Zustand store
├── utils/
│   ├── injector-script.ts  # MAIN world 注入脚本 (用于页面内 fetch 下载降级 + 独立检测 hooks)
│   ├── storage.ts          # chrome.storage 封装
│   ├── sanitize.ts         # 文件名清理、乱码检测
│   ├── directory-handle.ts # File System Access API (目录句柄管理, IndexedDB)
│   ├── offscreen-blob.ts   # Offscreen Document Blob URL 创建 + fetch→save-helper 流水线
│   ├── format.ts           # 文件大小/时间/速度/码率/分辨率格式化
│   └── hash.ts             # ID 生成 (视频指纹)
├── types/
│   └── index.ts           # 所有 TypeScript 类型定义 + 默认值 (含音频格式)
└── assets/                # 扩展图标
    ├── icon.png
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
assets/
├── offscreen.html/js   # Offscreen Document (Blob URL 创建)
└── save-helper.html/js # 保存辅助页面 (IndexedDB→chrome.downloads)
```

## 核心通信流程

### 视频检测 — 双路径架构

**路径 A (主路径): Plasmo MAIN world Content Script**
```
[src/content/index.ts] Plasmo CS (MAIN world, run_at: document_start)
  ├── network-interceptor.ts: Hook XHR/Fetch
  ├── dom-observer.ts: MutationObserver 扫描 DOM
  ├── blob-handler.ts: Hook URL.createObjectURL
  ├── hls-parser.ts: 内联 m3u8 解析
  ├── dash-parser.ts: DASH MPD 解析
  └── name-detector.ts: 标题检测
       ↓ chrome.runtime.sendMessage (VIDEO_DETECTED) — 直接发送
       ↓ 黑名单过滤在 content/index.ts 内完成
[Service Worker] background/index.ts
  (补充缺失文件大小, 保存到 storage, 更新 badge, 广播到 UI)
       ↓ chrome.runtime.sendMessage (VIDEO_DETECTED)
[Popup/SidePanel] UI 组件
```

**路径 B (辅助路径): 注入式 MAIN world 脚本**
```
[src/utils/injector-script.ts] chrome.scripting.executeScript({ world: 'MAIN' })
  (独立 Hook XHR/Fetch/Blob, 内联 m3u8 解析, 页面内 fetch 下载)
       ↓ window.postMessage (VIDEO_DOWNLOADER_DETECT)
[src/contents/detector.ts] Plasmo CS (ISOLATED world)
  (黑名单过滤、去重、元数据更新、转发下载进度/错误)
       ↓ chrome.runtime.sendMessage (VIDEO_DETECTED / PAGE_FETCH_* / PAGE_DOWNLOAD_DONE)
[Service Worker] background/index.ts
```

> 路径 A 是主要检测路径，由 Plasmo 自动注入。路径 B 由 background 在 tab 导航时手动注入，作为兼容层并用于页面内 fetch 下载 (Layer 3 降级)。

### 下载流程 (常规视频 — 多层级降级)
```
[UI] 用户点击下载
  → chrome.runtime.sendMessage (START_DOWNLOAD)
[Service Worker] download-manager.ts
  → URL 级去重，创建 DownloadTask, 加入队列
  → 从页面实时获取最新标题 (refreshTitleFromPage)
  → 根据 downloader 类型分发:
    ├── chrome:
    │   ├── HLS: → hls-downloader.ts (非阻塞)
    │   └── 非 HLS: 多层级降级:
    │       ├── Layer 1: 直接 chrome.downloads.download() (declarativeNetRequest + onDeterminingFilename)
    │       ├── Layer 2: offscreen fetch → save-helper (降级)
    │       ├── Layer 3: 页面 MAIN world fetch → blob URL → chrome.downloads (降级)
    │       └── Layer 4: save-helper 直接 fetch (最终降级)
    ├── aria2/motrix: RPC 调用
    └── idm: idm:// 协议
  → 广播进度 (DOWNLOAD_PROGRESS)
```

### 下载流程 (HLS 视频)
```
[Service Worker] download-manager.ts
  → hls-downloader.ts
  → 解析 m3u8 → 并行下载分片 → AES-128 解密
  → mux.js 转封装 (TS→fMP4) 或 fMP4 init segment 拼接
  → 保存: 目录句柄直接写入 或 IndexedDB + save-helper 页面
```

### 保存路径
1. **常规视频 — 优先**: File System Access API 目录句柄 → 直接写入
2. **常规视频 — 降级**: 多层级降级 (直接下载 → offscreen → 页面 fetch → save-helper)
3. **HLS 保存**: 目录句柄直接写入 (流式，低内存) 或 IndexedDB → save-helper 页面

## 消息类型 (chrome.runtime.sendMessage)

| 类型 | 方向 | 用途 |
|------|------|------|
| VIDEO_DETECTED | content→bg→ui | 报告检测到的视频/音频 |
| VIDEO_CLEARED | content→bg | 页面视频已清除 |
| CLEAR_ALL_VIDEOS | ui→bg | 清除所有检测到的视频 |
| GET_VIDEOS | ui→bg | 获取视频列表 |
| START_DOWNLOAD | ui→bg | 开始下载 |
| RETRY_DOWNLOAD | ui→bg | 重试失败的下载 |
| PAUSE_DOWNLOAD | ui→bg | 暂停下载 |
| CANCEL_DOWNLOAD | ui→bg | 取消下载 |
| REMOVE_DOWNLOAD | ui→bg | 删除下载任务 |
| GET_DOWNLOADS | ui→bg | 获取下载列表 |
| DOWNLOAD_PROGRESS | bg→ui | 下载进度更新 |
| DOWNLOAD_COMPLETE | bg→ui | 下载完成通知 |
| DOWNLOAD_FAILED | bg→ui | 下载失败通知 |
| GET_SETTINGS | ui→bg | 获取设置 |
| UPDATE_SETTINGS | ui→bg | 更新设置 |
| CLEAR_COMPLETED_DOWNLOADS | ui→bg | 清除已完成下载 |
| CLEAR_COMPLETED_FULL_DOWNLOADS | ui→bg | 清除已完成下载 (含文件) |
| CLEAR_FAILED_DOWNLOADS | ui→bg | 清除失败下载 |
| CLEAR_ORPHANED_DOWNLOADS | ui→bg | 清除孤立下载 (页面已关闭) |
| CLEAR_PAGE_DOWNLOADS | ui→bg | 清除指定页面的下载 |
| SAVE_HELPER_DONE | save-helper→bg | 保存完成，关闭辅助页 |
| SAVE_HELPER_PROGRESS | save-helper→bg | save-helper fetch 下载进度 |
| SAVE_HELPER_DOWNLOAD | bg→save-helper | save-helper 保存任务 |
| SAVE_HELPER_FETCH_DOWNLOAD | bg→save-helper | save-helper fetch 下载任务 |
| CREATE_OFFSCREEN_BLOB | bg→offscreen | 创建 Offscreen Document Blob URL |
| PAGE_FETCH_PROGRESS | page→bg | 页面 MAIN world fetch 下载进度 |
| PAGE_FETCH_ERROR | page→bg | 页面 fetch 诊断错误 |
| PAGE_DOWNLOAD_DONE | page→bg | 页面下载完成通知 |
| CHROME_DOWNLOAD_ID | page→bg | 报告 chrome.downloads 下载 ID |
| RESCAN_ALL_TABS | ui→bg | 重新扫描所有标签页 |
| CLEAR_VIDEOS_BY_URLS | ui→bg | 按URL清除检测到的视频 |
| CLEAR_ORPHANED_VIDEOS | ui→bg | 清除孤立视频 (页面已关闭) |

### Content Script 内部消息 (postMessage / chrome.tabs.sendMessage)

| 类型 | 方向 | 用途 |
|------|------|------|
| VIDEO_DOWNLOADER_DETECT | MAIN→ISOLATED | injector-script 报告检测到的视频 |
| VIDEO_DOWNLOADER_RESCAN | ISOLATED→MAIN | 通知 MAIN world 重新扫描 |
| DETECT_NOW | bg→ISOLATED | 触发重新检测 |
| GET_PAGE_VIDEOS | bg→ISOLATED | 获取 ISOLATED world 缓存的视频 |
| CLEAR_PAGE_VIDEOS | bg→ISOLATED | 清除 ISOLATED world 缓存 |

## 存储方案

| 存储 | 用途 |
|------|------|
| `chrome.storage.local` (app-settings) | 用户设置 |
| `chrome.storage.local` (detected-videos-{pageUrl}) | 检测到的视频缓存 |
| `chrome.storage.local` (download-tasks) | 下载任务持久化 |
| IndexedDB `video-downloader` (handles) | File System Access 目录句柄 |
| IndexedDB `vd-pending-saves` (pending-saves) | HLS 下载临时数据 (保存后自动清理) |

## HLS 下载细节

- m3u8 解析支持: master playlist (多码率) + media playlist
- 变体选择: 自动选择最高带宽
- 加密: AES-128 解密 (从 #EXT-X-KEY 获取密钥)
- 分片下载: 6 并发，可配置重试次数和超时
- 格式检测: 首字节 0x47=TS, ftyp/moof=fMP4
- TS 分片: 通过 mux.js `Transmuxer` 转为 fMP4 (ftyp+moov+moof+mdat)
- fMP4 分片: 下载 #EXT-X-MAP init segment 拼接到媒体分片前
- 输出: 统一为 .mp4 格式

## 常规视频下载细节

- **文件名获取**: 下载时实时从页面获取最新标题 (refreshTitleFromPage)，避免使用检测时的旧快照
- **Referer 设置**: 通过 `chrome.declarativeNetRequest` 设置 session 规则添加 Referer 请求头
- **Content-Disposition**: 通过 declarativeNetRequest 规则移除服务器返回的 Content-Disposition，防止覆盖文件名
- **文件名双重保障**: `filename` 参数 + `chrome.downloads.onDeterminingFilename` 回调
- **URL 级去重**: 同一 URL 不会创建重复下载任务
- **非阻塞下载**: HLS 下载使用 Promise 非阻塞启动，不阻塞队列
- **另存为**: 支持 `askSaveLocation` 设置，打开浏览器另存为对话框

## Chrome 权限

`downloads, storage, sidePanel, contextMenus, activeTab, tabs, scripting, alarms, offscreen, declarativeNetRequest`

host_permissions: `<all_urls>`

## 关键注意事项

- `assets/` 下的 HTML/JS 文件不经过 TypeScript 编译，必须使用纯 JavaScript（不能有类型注解）
- Service Worker 无 DOM，Blob URL 不可用；通过 Offscreen Document 或 save-helper 页面创建
- Service Worker 会被 Chrome 自动终止；使用 `chrome.alarms` (25s 间隔) 保活活跃下载
- 内容脚本采用双路径架构: `src/content/` (Plasmo MAIN world) 为主路径，`src/utils/injector-script.ts` + `src/contents/detector.ts` (ISOLATED world) 为辅助路径
- `injector-script.ts` 不能使用 import/export，必须自包含 (供 `chrome.scripting.executeScript` 注入)
- `injector-script.ts` 中报告视频使用 `window.postMessage` (不能直接使用 `chrome.runtime`)
- `src/content/` (Plasmo MAIN world) 可以直接使用 `chrome.runtime.sendMessage`
- IndexedDB 的 `onupgradeneeded` 仅在版本变化时触发；打开已有数据库需检查 store 是否存在
- `new Promise` executor 回调内的异步回调（如 `onsuccess`）中抛出的异常不会被 Promise 捕获，需 try/catch
- 目录句柄 (File System Access API) 在浏览器重启后权限可能失效，需重新验证
- `startChromeNativeDownload` 必须提取为独立函数，避免 ESBuild minifier 去掉分号导致 ASI (Automatic Semicolon Insertion) 问题
- Tab 导航 (`tabs.onUpdated` loading + complete) 时自动重新注入 MAIN world 脚本
- 音频格式 (mp3/m4a/aac/flac/ogg/wav/wma/opus) 同样被检测和支持下载

## UI 入口

- **Popup**: 点击扩展图标弹出 (宽度可配 320/400/500)，含视频列表 + 下载状态面板切换
- **SidePanel**: Popup 中按钮或 action.onClicked 打开
- **Options**: 扩展右键菜单"选项"或 Popup 设置按钮，含下载历史表格
- **Preview**: 新标签页中嵌入视频播放器 (FullPlayer 组件)

## Popup VideoItem 功能

- 版本面板: 展开显示同 URL 不同分辨率/大小的版本列表
- 下载控制: 内联进度条、暂停、取消、重试按钮
- 状态标签: 下载中/合并中/已完成/失败/已暂停

## Context Menu

- **检测此页视频** (page/frame): 发送 DETECT_NOW 重新扫描
- **下载此视频** (video): 直接下载 `<video>` 元素的 srcUrl
- **下载链接中的视频** (link): 直接下载 `<a>` 链接中的视频

## Agent skills

### Issue tracker

Issues and PRDs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo. Skills should read `CONTEXT.md` (if present) and `docs/adr/` before exploring. See `docs/agents/domain.md`.
