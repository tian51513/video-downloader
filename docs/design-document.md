# Video Downloader — Chrome Extension 设计文档

> 版本: 1.1.1 | 最后更新: 2026-06-07

## 1. 项目概述

Video Downloader 是一个基于 Chrome MV3 架构的视频检测与下载扩展，能够自动发现网页中的视频/音频资源，并提供多种下载方式。支持 MP4、MKV、WebM、HLS (m3u8)、DASH (mpd)、Blob URL 等主流格式。

### 1.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Plasmo (Chrome Extension) | 0.90.x |
| 语言 | TypeScript | 5.6 |
| UI | React + Ant Design + @ant-design/icons | 18 / 5.x / 5.x |
| 状态管理 | Zustand | 5.x |
| 视频处理 | mux.js (TS→fMP4 转封装) | 6.x |
| 流媒体 | hls.js, dashjs | 1.5.x, 4.7.x |
| 构建 | Plasmo 内置 (SWC + ESBuild) | — |
| 测试 | Vitest + @testing-library/react + jsdom | 4.x |
| 包管理 | pnpm | — |

### 1.2 Chrome 权限

```
permissions: downloads, storage, sidePanel, contextMenus, activeTab, tabs, scripting, alarms, offscreen, declarativeNetRequest
host_permissions: <all_urls>
```

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Chrome Extension                               │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐          │
│  │  Popup    │  │ SidePanel│  │  Options │  │ Preview Tab   │          │
│  │ (React)  │  │ (React)  │  │ (React)  │  │ (React)      │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘          │
│       │              │              │                │                   │
│       └──────────────┴──────────────┴────────────────┘                   │
│                         │ chrome.runtime.sendMessage                    │
│  ┌──────────────────────┴──────────────────────────────────────┐       │
│  │              Service Worker (background/index.ts)              │       │
│  │  ┌─────────────────┐  ┌──────────────────────────┐           │       │
│  │  │ download-manager │  │    hls-downloader        │           │       │
│  │  │ (队列/降级下载)  │  │ (m3u8→分片→解密→转封装) │           │       │
│  │  └─────────────────┘  └──────────────────────────┘           │       │
│  │  ┌─────────────────┐  ┌──────────────────────────┐           │       │
│  │  │    settings      │  │     hls-parser           │           │       │
│  │  └─────────────────┘  └──────────────────────────┘           │       │
│  └──────────┬──────────────────────────┬─────────────────────────┘       │
│             │                          │                                 │
│  ┌──────────┴──────────┐  ┌────────────┴────────────────────────┐       │
│  │ 路径 A (主路径)      │  │ 路径 B (辅助路径)                    │       │
│  │ MAIN world CS       │  │                                      │       │
│  │ (Plasmo 自动注入)    │  │ ISOLATED world (contents/detector)   │       │
│  │ src/content/         │  │  消息中转 + 黑名单过滤 + 去重         │       │
│  │ XHR/Fetch Hook      │  └────────────┬────────────────────────┘       │
│  │ DOM 扫描 + Blob Hook │    window.postMessage                      │
│  │ m3u8/DASH 解析      │  ┌────────────┴────────────────────────┐       │
│  │ chrome.runtime 直接 │  │ MAIN world (injector-script.ts)       │       │
│  └─────────────────────┘  │ XHR/Fetch/Blob Hook + DOM 扫描         │       │
│                            │ m3u8 解析 + 页面内 fetch 下载          │       │
│                            └─────────────────────────────────────┘       │
│                                                                         │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────────┐          │
│  │ Offscreen Doc│  │ save-helper    │  │ chrome.downloads  │          │
│  │ (Blob URL)   │  │ (大文件保存)   │  │ (浏览器原生下载)  │          │
│  └──────────────┘  └────────────────┘  └───────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 文件结构

```
src/
├── __tests__/                        # Vitest 单元测试
│   ├── setup.ts
│   ├── download-*.test.ts            # 下载相关测试
│   ├── injector-m3u8-parser.test.ts  # m3u8 解析测试
│   ├── VideoItem-version-panel.test.ts
│   └── SidePanel-download-state.test.ts
│
├── background/                       # Service Worker (扩展核心)
│   ├── index.ts                      # 消息路由、生命周期、注入、Context Menu、Badge
│   ├── download-manager.ts           # 下载队列、多层级降级、并发控制、进度追踪
│   ├── hls-downloader.ts             # HLS 下载编排 (m3u8→分片→解密→mux.js→保存)
│   ├── hls-parser.ts                 # m3u8 解析 (master/media playlist)
│   └── settings.ts                   # 设置读写
│
├── contents/
│   └── detector.ts                   # Content Script (ISOLATED world)，消息中转
│
├── popup/                            # 弹出窗口 UI
│   ├── index.tsx                     # 主界面：视频列表 + 下载控制
│   └── components/
│       ├── VideoList.tsx             # 视频列表容器 + 全部下载按钮
│       └── VideoItem.tsx             # 视频分组卡片、版本面板、进度条
│
├── sidepanel/                        # 侧边栏 UI
│   ├── index.tsx                     # 详细视图：视频列表 + 过滤 + 批量操作
│   └── components/
│       ├── FilterPanel.tsx           # 6 维过滤面板
│       ├── BatchActions.tsx          # 批量下载 + 下载器选择
│       └── PreviewPlayer.tsx         # 内联播放器 (HLS/DASH/原生)
│
├── options/                          # 设置页 UI
│   ├── index.tsx                     # 6 标签页设置
│   └── components/
│       ├── DownloadSettings.tsx      # 下载配置
│       ├── DownloadHistory.tsx       # 下载历史表格 (实时进度)
│       ├── NamingSettings.tsx        # 文件命名模板
│       ├── BlacklistManager.tsx      # 黑名单规则管理
│       ├── AppearanceSettings.tsx    # 外观设置
│       └── ExternalDownloaderSettings.tsx  # 外部下载器配置
│
├── tabs/preview/                     # 新标签页预览
│   ├── index.tsx
│   └── components/
│       └── FullPlayer.tsx            # 全屏播放器
│
├── store/                            # Zustand 状态管理
│   ├── video-store.ts                # 视频列表 + 过滤 + 分组
│   ├── download-store.ts             # 下载任务状态
│   └── settings-store.ts             # 设置同步
│
├── utils/                            # 工具函数
│   ├── injector-script.ts            # MAIN world 注入脚本 (自包含，无外部依赖)
│   ├── storage.ts                    # chrome.storage.local 封装
│   ├── sanitize.ts                   # 文件名清理、乱码检测
│   ├── format.ts                     # 显示格式化 (大小/时间/速度/码率/分辨率)
│   ├── hash.ts                       # SHA-256 视频指纹生成
│   ├── directory-handle.ts           # File System Access API (IndexedDB 持久化)
│   └── offscreen-blob.ts             # Offscreen Document Blob URL 管理
│
├── types/
│   └── index.ts                      # 所有类型定义 + 默认值 + 格式映射
│
assets/
├── offscreen.html + offscreen.js     # Offscreen Document (纯 JS)
└── save-helper.html + save-helper.js # 保存辅助页面 (纯 JS)
```

---

## 3. 核心数据模型

### 3.1 DetectedVideo — 检测到的视频

```typescript
interface DetectedVideo {
  id: string                // SHA-256 哈希指纹 (url|quality 的前 16 位 hex)
  url: string               // 视频 URL
  title: string             // 视频标题 (og:title > document.title > h1 > URL 路径)
  format: MediaFormat       // 格式: mp4/mkv/webm/hls/dash/blob/mp3/...
  mimeType: string          // Content-Type
  mediaType?: MediaType     // 'video' | 'audio'
  size?: number             // 文件大小 (bytes)
  width?: number            // 视频宽度
  height?: number           // 视频高度
  sampleRate?: number       // 音频采样率
  channels?: number         // 音频声道数
  duration?: number         // 时长 (秒)
  bitrate?: number          // 码率 (bps)
  source: DetectionSource   // 'network' | 'dom' | 'blob'
  pageUrl: string           // 所属页面 URL
  domain: string            // 页面域名
  segments?: string[]       // HLS 分片 URL 列表
  encryption?: VideoEncryption  // 加密信息 (AES-128 keyUrl)
  detectedAt: number        // 检测时间戳
}
```

### 3.2 DownloadTask — 下载任务

```typescript
interface DownloadTask {
  id: string                    // dl_{timestamp}_{random}
  video: DetectedVideo          // 关联的视频
  status: DownloadStatus        // pending|downloading|merging|completed|failed|paused
  progress: number              // 0-100
  speed: number                 // bytes/s
  downloadedBytes: number       // 已下载字节数
  totalBytes: number            // 总字节数
  filePath?: string             // 保存路径
  savedFileName?: string        // 最终文件名
  chromeDownloadId?: number     // chrome.downloads ID
  error?: string                // 错误信息
  downloader: DownloaderType    // chrome|idm|aria2|motrix|custom
  startedAt?: number            // 开始时间
  completedAt?: number          // 完成/失败时间
}
```

### 3.3 VideoGroup — 视频分组

```typescript
interface VideoGroup {
  title: string           // 视频标题 (sanitizeTitle 处理后)
  pageUrl: string         // 所属页面
  versions: DetectedVideo[]  // 同标题的不同版本 (分辨率/码率)
  primaryIndex: number    // 主版本索引 (最高分辨率/码率)
}
```

分组逻辑：以 `title + pageUrl` 为 key。同一视频的不同分辨率/码率会被归入同一组。组内版本按视频分辨率降序、音频码率降序排列。无效标题（纯数字、纯 hex、空值）的视频各自独立成组。

### 3.4 AppSettings — 应用设置

```typescript
interface AppSettings {
  downloadSettings: DownloadSettings   // 并发数/重试/超时
  defaultDownloader: DownloaderType    // 默认下载器
  baseSaveDirectory: string            // 基础保存目录
  saveByDomain: boolean                // 按域名分目录保存
  customSaveRules: CustomSaveRule[]    // 自定义保存规则
  namingTemplate: string               // 命名模板 ({name}.{format})
  blacklist: BlacklistRule[]           // 黑名单规则
  filter: VideoFilter                  // 默认过滤条件
  themeMode: ThemeMode                 // 主题模式
  accentColor: string                  // 主题色
  language: 'zh' | 'en'               // 语言
  popupWidth: 320 | 400 | 500         // 弹窗宽度
  listDensity: ListDensity             // 列表密度
  visibleColumns: VisibleColumn[]      // 可见列
  notifications: boolean               // 下载通知
  autoCleanupDays: number              // 自动清理天数
  externalDownloaderConfig: ExternalDownloaderConfig  // 外部下载器配置
}
```

---

## 4. 核心流程

### 4.1 视频检测流程

#### 路径 A (主路径): Plasmo MAIN world Content Script

```
┌────────────────────────────────────────────────────────────────────┐
│  MAIN world (src/content/) — Plasmo 自动注入                        │
│                                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ XHR Hook    │  │ Fetch Hook  │  │ Blob Hook   │               │
│  │ (open/send) │  │ (fetch)     │  │ (createURL) │               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         │                │                │                        │
│         ▼                ▼                ▼                        │
│  ┌──────────────────────────────────────────────┐                │
│  │ 格式识别 + m3u8/DASH 解析                     │                │
│  │ DOM Scanner + name-detector                  │                │
│  │ 黑名单过滤 (content/index.ts 内完成)          │                │
│  └──────────────────────┬───────────────────────┘                │
│                         │                                         │
│                         ▼                                         │
│          chrome.runtime.sendMessage(VIDEO_DETECTED) — 直接发送     │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
┌─────────────────────────┴──────────────────────────────────────────┐
│  Service Worker (background/index.ts)                              │
│  补充文件大小 → 存储 → Badge → 广播到 UI                          │
└────────────────────────────────────────────────────────────────────┘
```

#### 路径 B (辅助路径): 注入式 MAIN world 脚本

```
┌────────────────────────────────────────────────────────────────────┐
│  MAIN world (injector-script.ts) — tabs.onUpdated 手动注入          │
│                                                                    │
│  独立 XHR/Fetch/Blob Hook + DOM 扫描 + m3u8 解析                  │
│  页面内 fetch 下载 (Layer 3 降级)                                  │
│                         │                                         │
│                         ▼                                         │
│              window.postMessage(VIDEO_DOWNLOADER_DETECT)            │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
┌─────────────────────────┴──────────────────────────────────────────┐
│  ISOLATED world (contents/detector.ts)                             │
│  去重 → 黑名单过滤 → 元数据合并 → chrome.runtime.sendMessage       │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
┌─────────────────────────┴──────────────────────────────────────────┐
│  Service Worker (background/index.ts)                              │
│  补充文件大小 → 存储 → Badge → 广播到 UI                          │
└────────────────────────────────────────────────────────────────────┘
```

> 路径 A 是主要检测路径，由 Plasmo 在页面加载时自动注入。路径 B 由 background 在 tab 导航时手动注入，作为兼容层并用于页面内 fetch 下载 (Layer 3 降级)。

**检测手段详情：**

| 手段 | 原理 | 覆盖格式 |
|------|------|---------|
| XHR Hook | 拦截 XMLHttpRequest.prototype.open/send | 全格式 |
| Fetch Hook | 拦截 window.fetch | 全格式 |
| Blob Hook | 拦截 URL.createObjectURL | blob |
| DOM Scanner | MutationObserver 监听 video/source 元素 | mp4/webm/... |
| iframe Scanner | 扫描 iframe src 及 URL 参数 | 全格式 |
| Config Scanner | 读取 JS 全局变量 (flashvars, videoConfig 等) | 全格式 |
| loadedmetadata | 监听 video 元素 loadedmetadata 事件获取分辨率/时长 | 全格式 |
| m3u8 解析 | 内联解析 master/media playlist | HLS |
| Multi-Quality | 特定网站的多码率 URL 参数解析 | HLS |

### 4.2 常规视频下载流程 (多层级降级)

```
用户点击下载
     │
     ▼
START_DOWNLOAD → download-manager.ts
     │
     ├─ URL 级去重 (同 URL 不重复创建)
     ├─ 从页面获取最新标题 (chrome.scripting.executeScript)
     └─ 加入下载队列
           │
           ▼
     ┌─────────────────────────────────────────┐
     │  设置 Referer (declarativeNetRequest)    │
     │  移除 Content-Disposition               │
     └─────────────────┬───────────────────────┘
                       │
          ┌────────────┼────────────┬──────────────┐
          ▼            ▼            ▼              ▼
     ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐
     │ Layer 1 │ │ Layer 2 │ │ Layer 3  │ │ Layer 4  │
     │ chrome  │ │offscreen│ │ 页面 MAIN│ │save-helper│
     │downloads│ │ fetch   │ │ world    │ │ 直接 fetch │
     │  ↓      │ │  ↓      │ │  fetch   │ │  ↓        │
     │ 监控    │ │save-hlp │ │  ↓       │ │ save-hlp  │
     │ onChan- │ │  ↓      │ │save-hlp  │ │  ↓        │
     │ ged     │ │chrome   │ │chrome    │ │chrome     │
     │         │ │downloads│ │downloads │ │downloads  │
     └─────────┘ └─────────┘ └──────────┘ └──────────┘
          │            │            │              │
          └────────────┴────────────┘              │
                       ▼                          │
              下载完成 → 广播 DOWNLOAD_PROGRESS    │
                                     ─────────────┘
```

**各层级说明：**

| 层级 | 方式 | 适用场景 |
|------|------|---------|
| Layer 1 | `chrome.downloads.download()` + `declarativeNetRequest` | 标准 HTTP 下载，无 CORS 限制 |
| Layer 2 | Offscreen Document fetch → save-helper | CORS 受限，但可通过 offscreen 绕过 |
| Layer 3 | 页面 MAIN world fetch → Blob URL → chrome.downloads | 需要页面 Cookie/Referer |
| Layer 4 | save-helper 页面直接 fetch | 最终兜底方案 |

**进度监控：**
- Layer 1：`chrome.downloads.onChanged` 事件 + 1s 轮询
- Layer 2/3/4：页面 fetch 进度 → `PAGE_FETCH_PROGRESS` 消息 → Service Worker → 广播

**文件名双重保障：**
1. `chrome.downloads.download({ filename })` 参数
2. `chrome.downloads.onDeterminingFilename` 回调 (当 declarativeNetRequest 未完全移除 Content-Disposition 时)

### 4.3 HLS 下载流程

```
START_DOWNLOAD (format='hls')
     │
     ▼
download-manager.ts → downloadHLS()
     │
     ├─ 下载 m3u8 → hls-parser.ts 解析
     │   ├─ Master Playlist → 选择最高带宽变体
     │   └─ Media Playlist → 获取分片列表
     │
     ├─ 并行下载分片 (worker pool, 可配并发数)
     │   ├─ 每片独立超时 + 重试
     │   └─ 进度回调 → DOWNLOAD_PROGRESS 广播
     │
     ├─ [如加密] AES-128 解密
     │   ├─ 获取 Key URL (可能需要页面 Referer)
     │   └─ Web Crypto AES-CBC 解密
     │
     ├─ 格式检测 (首字节)
     │   ├─ 0x47 = MPEG-TS
     │   └─ ftyp/moof = fMP4
     │
     ├─ 转封装
     │   ├─ TS → mux.js Transmuxer → fMP4 (ftyp+moov+moof+mdat)
     │   └─ fMP4 → 下载 #EXT-X-MAP init segment → 拼接
     │
     └─ 保存
         ├─ 方式1: File System Access API (目录句柄直接写入，流式低内存)
         └─ 方式2: IndexedDB → save-helper.html 页面 (兜底)
```

**HLS 加密处理：**

```typescript
interface HlsEncryption {
  method: string          // 'AES-128'
  keyUrl?: string         // 密钥 URL
  iv?: Uint8Array         // 初始化向量 (每片用 sequence number 生成)
}
```

- 通过 `#EXT-X-KEY` 标签获取加密信息
- 无显式 IV 时使用 `buildSequenceIv(index)` 生成 (16 字节，前 12 字节为 0，后 4 字节为 sequence number)
- 密钥获取失败时跳过解密，尝试直接合并

**HLS 标题优化：**
- 检测自动生成的标题 (如 `index`, `segment`, `playlist`) 并替换
- 从页面 URL 获取 `og:title` 或 `<title>` 作为更佳标题
- 清理站点后缀 (如 ` | YouTube`, ` - Vimeo`)

### 4.4 外部下载器

```typescript
// aria2: JSON-RPC 调用
POST {aria2RpcUrl}
{
  "jsonrpc": "2.0",
  "method": "aria2.addUri",
  "params": [["url"], { dir, out, header: ["Referer: ..."] }]
}

// IDM: 协议调用
idm://{encoded_url}

// Motrix: 同 aria2 RPC
```

---

## 5. 通信机制

### 5.1 消息类型

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `VIDEO_DETECTED` | content → bg → ui | 报告检测到的视频 |
| `VIDEO_CLEARED` | content → bg | 页面视频已清除 |
| `GET_VIDEOS` | ui → bg | 获取视频列表 |
| `START_DOWNLOAD` | ui → bg | 开始下载 |
| `PAUSE_DOWNLOAD` | ui → bg | 暂停下载 |
| `CANCEL_DOWNLOAD` | ui → bg | 取消下载 |
| `RETRY_DOWNLOAD` | ui → bg | 重试下载 |
| `REMOVE_DOWNLOAD` | ui → bg | 删除下载任务 |
| `DOWNLOAD_PROGRESS` | bg → ui | 下载进度更新 |
| `GET_DOWNLOADS` | ui → bg | 获取下载任务列表 |
| `GET_SETTINGS` | ui → bg | 获取设置 |
| `UPDATE_SETTINGS` | ui → bg | 更新设置 |
| `CLEAR_ALL_VIDEOS` | ui → bg | 清除所有视频 |
| `CLEAR_COMPLETED_DOWNLOADS` | ui → bg | 清除已完成任务 |
| `CLEAR_COMPLETED_FULL_DOWNLOADS` | ui → bg | 清除已完成任务 (完整) |
| `CLEAR_FAILED_DOWNLOADS` | ui → bg | 清除失败任务 |
| `CLEAR_ORPHANED_DOWNLOADS` | ui → bg | 清除孤立下载 |
| `CLEAR_ORPHANED_VIDEOS` | ui → bg | 清除孤立视频 |
| `CLEAR_PAGE_DOWNLOADS` | ui → bg | 清除页面下载 |
| `CLEAR_VIDEOS_BY_URLS` | ui → bg | 按 URL 清除视频 |
| `PAGE_FETCH_PROGRESS` | page → bg | 页面 fetch 进度 |
| `PAGE_FETCH_ERROR` | page → bg | 页面 fetch 错误 |
| `PAGE_DOWNLOAD_DONE` | page → bg | 页面下载完成 |
| `SAVE_HELPER_DONE` | save-helper → bg | 保存完成 |
| `SAVE_HELPER_PROGRESS` | save-helper → bg | 保存进度 |
| `CHROME_DOWNLOAD_ID` | ui → bg | 注册 chrome downloads ID |
| `RESCAN_ALL_TABS` | ui → bg | 重新扫描所有标签页 |
| `CREATE_OFFSCREEN_BLOB` | bg → offscreen | 创建 Blob URL |
| `SAVE_HELPER_DOWNLOAD` | bg → save-helper | 触发保存辅助下载 |
| `SAVE_HELPER_FETCH_DOWNLOAD` | bg → save-helper | 触发直接 fetch 下载 |

### 5.2 通信架构

```
MAIN world ←→ (postMessage) ←→ ISOLATED world ←→ (sendMessage) ←→ Service Worker ←→ (sendMessage) ←→ UI
```

MAIN world 无法直接使用 Chrome Extension API，因此需要两层中转：
1. MAIN world 通过 `window.postMessage` 发送到 ISOLATED world
2. ISOLATED world 的 content script 通过 `chrome.runtime.sendMessage` 转发到 Service Worker
3. Service Worker 通过广播消息通知所有 UI (popup, sidepanel, options)

---

## 6. 存储方案

| 存储引擎 | 键 | 用途 | 生命周期 |
|---------|---|------|---------|
| `chrome.storage.local` | `app-settings` | 用户设置 | 持久 |
| `chrome.storage.local` | `detected-videos` | 检测到的视频 (`Record<pageUrl, Video[]>`) | 持久 |
| `chrome.storage.local` | `download-tasks` | 下载任务列表 | 持久 |
| `IndexedDB` | `video-downloader / handles` | File System Access 目录句柄 | 跨重启持久 (权限可能失效) |
| `IndexedDB` | `vd-pending-saves / pending-saves` | HLS 下载临时数据 | 保存后自动清理 |
| 内存 (Map) | `pageVideos` | Service Worker 视频缓存 | SW 存活期间 |
| 内存 (Map) | `downloadQueue` | Service Worker 下载队列 | SW 存活期间 |
| 内存 (Zustand) | `video-store` | UI 视频列表状态 | UI 窗口生命周期 |
| 内存 (Zustand) | `download-store` | UI 下载任务状态 | UI 窗口生命周期 |
| 内存 (Zustand) | `settings-store` | UI 设置状态 | UI 窗口生命周期 |

**Service Worker 保活策略：**
- 使用 `chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })` (24 秒间隔)
- 只在有活跃下载时保活
- 无活跃下载时让 SW 自然休眠，下次消息唤醒时从 storage 恢复队列

---

## 7. UI 设计

### 7.1 Popup (弹出窗口)

**尺寸**: 可配置 320px / 400px / 500px 宽，最大 500px 高。

**布局**:
```
┌──────────────────────────────────┐
│ [标题 + 视频数量]  [清除▼][面板][设置] │  ← 头部
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 🎬 视频标题      [▶][⬇]    │ │  ← 折叠状态
│ │    MP4 1080p  256MB  12:30  │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 🎬 视频标题    [下载中] [⏸][✕] │ │  ← 活跃下载
│ │    MP4 720p   ████████░░ 80% │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ ▼ 视频标题      3 个版本    │ │  ← 展开状态
│ ├──────────────────────────────┤ │
│ │   MP4 1080p  256MB  [▶][⬇]  │ │
│ │   MP4 720p   128MB  [▶][⬇]  │ │
│ │   MP4 480p    64MB  [▶][⬇]  │ │
│ ├──────────────────────────────┤ │
│ │      [全部下载 (3 个版本)]    │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**清除操作菜单**:

| 操作 | 功能 |
|------|------|
| 清除所有视频 | 清空视频列表 + 重新扫描 |
| 清除当前页面下载 | 清除当前 URL 的下载记录 |
| 清除已完成 | 移除 status=completed 的任务 |
| 清除已完成(完整) | 移除已完成任务 + 对应视频 |
| 清除失败 | 移除 status=failed 的任务 |
| 清除已关闭页面 | 移除已关闭标签页的视频和下载 |

### 7.2 SidePanel (侧边栏)

比 Popup 更宽的详细视图，额外提供：
- **FilterPanel**: 6 维过滤 (格式/分辨率/大小/时长/来源/类型) + 排序
- **BatchActions**: 下载器选择 + 批量下载
- **PreviewPlayer**: 内联视频/音频播放 (HLS/DASH 原生支持)

### 7.3 Options (设置页)

6 个标签页：

| 标签 | 组件 | 功能 |
|------|------|------|
| 下载历史 | DownloadHistory | 表格展示 + 实时进度 + 暂停/重试/删除 |
| 下载设置 | DownloadSettings | 并发/重试/超时/保存路径/另存为 |
| 命名规则 | NamingSettings | 模板编辑 + 变量插入 |
| 黑名单 | BlacklistManager | 规则 CRUD (domain/url/regex) |
| 外部下载器 | ExternalDownloaderSettings | aria2/IDM/自定义命令 |
| 外观 | AppearanceSettings | 主题/颜色/语言/宽度/密度 |

### 7.4 Preview (预览页)

新标签页全屏播放器，支持：
- HLS (hls.js) / DASH (dashjs) / 原生 video/audio
- 播放/暂停 + 全屏 + 下载按钮
- 视频元数据展示 (格式/分辨率/大小/时长/码率)

---

## 8. 关键实现细节

### 8.1 MAIN world 注入脚本

`injector-script.ts` 是整个检测系统的核心，运行在 MAIN world 中。关键约束：

- **完全自包含**：不能引用外部模块，所有函数和常量内联定义
- **注入时机**：`tabs.onUpdated` 的 `loading` 阶段立即注入 (建立 hooks)，`complete` 阶段再次注入 (DOM 扫描)
- **Cleanup**：`beforeunload` 时恢复所有被 monkey-patch 的原型方法
- **iframe 支持**：`allFrames: true` 注入，通过 `document.referrer` 获取父页面上下文
- **重新扫描**：监听 `VIDEO_DOWNLOADER_RESCAN` 消息，清空缓存后重新检测

### 8.2 Service Worker 生命周期管理

Chrome MV3 Service Worker 会被自动终止，采取以下策略：

1. **定时保活**：24 秒 alarm (在有活跃下载时)
2. **队列持久化**：每次任务状态变更都写入 `chrome.storage.local`
3. **延迟恢复**：收到消息时调用 `getAllDownloadTasks()` 从 storage 恢复队列
4. **Badge 更新**：每次 `tabs.onActivated` 时重新计算全局视频数

### 8.3 文件名生成

```
模板: {name}.{format}
变量: {name} = 视频标题 (去除扩展名)
      {format} = 文件格式 (mp4/mkv/...)
      {date} = 日期 (YYYY-MM-DD)
      {time} = 时间 (HH-MM-SS)
      {domain} = 页面域名

清理规则:
- 替换 \/:*?"<>| → _
- 合并多余空格
- 合并多余点号
- 截断到 200 字符
- 避免重复扩展名
```

### 8.4 视频标题智能检测

优先级链：
```
og:title → document.title (清理后) → <h1> →
附近 video 元素文本 → URL 路径分段 → {domain}_{timestamp}
```

乱码检测规则 (`isGarbled`)：
- 空 / 纯数字 (4+位) / 纯 hex (16+位)
- URL 编码比例 > 30%
- 控制字符比例 > 20%

### 8.5 下载队列与并发

```
processQueue():
  while true:
    hlsActiveCount = activeDownloads 中 HLS 任务数
    next = pending 非 HLS 任务 || (hlsActiveCount < maxConcurrent ? pending 任务 : null)
    if !next: break
    fire-and-forget 下载 (不阻塞队列)
```

- 所有下载都是 fire-and-forget (非阻塞)
- HLS 任务受 `maxConcurrent` 限制，其他任务不限制
- `chrome.downloads` 下载由浏览器管理，不占 SW 槽位

---

## 9. 黑名单系统

默认黑名单 (广告追踪域名)：
- `doubleclick.net`
- `googlesyndication.com`
- `adnxs.com`
- `adservice.google.com`

支持三种匹配类型：

| 类型 | 匹配方式 | 示例 |
|------|---------|------|
| `domain` | 视频来源域名包含 | `doubleclick.net` |
| `url` | 视频 URL 包含 | `/ad/` |
| `regex` | 正则表达式匹配 | `/ads\/\d+/` |

黑名单过滤在 ISOLATED world (contents/detector.ts) 中执行，被过滤的视频不会发送到 Service Worker。

---

## 10. 测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `download-*.test.ts` | 下载策略、去重、进度、文件名、规则、降级 |
| `injector-m3u8-parser.test.ts` | MAIN world m3u8 解析 |
| `VideoItem-version-panel.test.ts` | 版本面板展开/收起 |
| `SidePanel-download-state.test.ts` | 侧边栏下载状态同步 |

---

## 11. 构建与部署

```bash
pnpm dev          # 开发模式 (热重载)
pnpm build        # 生产构建
pnpm clean        # 清理产物
pnpm test         # 运行测试
pnpm test:watch   # 测试监视模式
```

构建流程：
1. `plasmo build` → TypeScript 编译 (SWC) + 打包 (ESBuild) → `build/chrome-mv3-prod/`
2. 复制 `assets/` 下的 HTML/JS 到 `build/chrome-mv3-prod/` (offscreen + save-helper)
3. 产物通过 `chrome://extensions` 加载 (开发者模式)

---

## 12. 已知限制与注意事项

1. **Service Worker 无 DOM**：不能使用 `URL.createObjectURL`、`Blob` 等，通过 Offscreen Document 绕过
2. **assets/ 文件为纯 JS**：offscreen.html/js 和 save-helper.html/js 不经过 TypeScript 编译
3. **目录句柄权限**：浏览器重启后 File System Access API 权限可能失效，需要重新验证
4. **ESBuild minifier**：`startChromeNativeDownload` 必须提取为独立函数，避免 ASI 问题
5. **IndexedDB onupgradeneeded**：仅在版本变化时触发，已有数据库需手动检查 store 是否存在
6. **Promise executor 异步回调**：其中的 `onsuccess` 等异步回调异常不会被 Promise 捕获，需 try/catch
7. **Badge 更新**：去重后的视频标题数，跨所有标签页统计
8. **CORS 限制**：部分网站阻止 HEAD 请求获取文件大小，此情况文件大小将保持未知
