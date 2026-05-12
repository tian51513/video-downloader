# 视频下载 Chrome 扩展 - 设计文档

**日期：** 2026-05-12
**状态：** 已批准
**目标：** 个人使用的 Chrome 浏览器扩展，用于检测和下载网页视频

## 概述

一个基于 Chrome Manifest V3 的浏览器扩展，能够检测任意网页中的视频，并提供下载、预览和管理功能。支持常规视频格式（mp4/mkv/rmvb/rm/flv/avi 等）、HLS 流媒体和 DASH 流媒体。

## 技术栈

| 组件 | 选型 |
|------|------|
| 框架 | Plasmo + React 18 + TypeScript |
| UI 组件库 | Ant Design |
| 状态管理 | Zustand |
| HLS 支持 | HLS.js |
| DASH 支持 | dash.js |
| 日期处理 | dayjs |
| 构建 | Plasmo CLI（pnpm dev / pnpm build） |
| 扩展标准 | Chrome Manifest V3 |

## 架构

```
┌─────────────────────────────────────────────────┐
│                   Chrome 扩展                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Popup   │  │  Options │  │  SidePanel   │  │
│  │ (快速操作)│  │ (设置页) │  │ (详细列表)   │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │          │
│  ┌────┴──────────────┴───────────────┴───────┐  │
│  │         Background Service Worker          │  │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────┐  │  │
│  │  │ 视频检测 │ │ 下载管理  │ │ 设置管理  │  │  │
│  │  │  引擎   │ │          │ │          │  │  │
│  │  └────┬────┘ └────┬─────┘ └───────────┘  │  │
│  └───────┼──────────┼───────────────────────┘  │
│          │          │                           │
│  ┌───────┴──────────┴───────────────────────┐  │
│  │          Content Script（注入网页）         │  │
│  │  ┌───────────┐ ┌──────────┐ ┌─────────┐  │  │
│  │  │ 网络拦截   │ │ DOM 监听 │ │ M3U8/   │  │  │
│  │  │(XHR/Fetch)│ │(video/   │ │ MPD 解析│  │  │
│  │  │           │ │ source)  │ │         │  │  │
│  │  └───────────┘ └──────────┘ └─────────┘  │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │              外部下载器接口                  │  │
│  │     IDM / aria2 / Motrix / 自定义命令      │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 分层职责

| 层 | 职责 |
|---|------|
| Content Script | 注入到目标网页。Hook XHR/Fetch 拦截网络请求。通过 MutationObserver 监听 DOM 中的 `<video>`/`<source>` 元素。解析 HLS（.m3u8）和 DASH（.mpd）清单文件。 |
| Background Service Worker | 协调中心。接收 Content Script 上报的视频信息。管理下载队列及并发控制。通过 chrome.storage 持久化设置、黑名单和过滤条件。协调 UI 与下载逻辑。 |
| UI（Popup / Options / SidePanel） | Popup 显示当前页面检测到的视频列表。Options 提供完整设置管理。SidePanel 提供详细视图，包含预览、过滤和批量操作。 |

### 核心数据流

```
网页加载 → Content Script 拦截网络 + 监听 DOM
         → 提取视频 URL、格式、分辨率等信息
         → 发送至 Background Service Worker
         → Worker 去重、过滤黑名单、匹配智能命名
         → UI 层从 Worker 获取视频列表展示
         → 用户选择下载 → Worker 调用 Chrome Downloads API 或外部下载器
```

## 功能 1：视频检测引擎

### 检测策略

**策略 1：网络请求拦截**

Content Script 注入页面后 hook 以下页面级 API：

- `XMLHttpRequest.open()` → 拦截 URL 参数
- `fetch()` → 拦截 URL 参数
- `<video>`/`<source>` 元素 → MutationObserver 持续监听

**匹配规则（扩展名 + Content-Type 双重判断）：**

| 类别 | 匹配规则 |
|------|---------|
| 常规视频 | `.mp4` `.mkv` `.flv` `.avi` `.rmvb` `.rm` `.webm` `.mov` `.ts` |
| HLS 流媒体 | URL 包含 `.m3u8` 或响应 Content-Type 为 `application/vnd.apple.mpegurl` |
| DASH 流媒体 | URL 包含 `.mpd` 或响应 Content-Type 为 `application/dash+xml` |
| Blob 视频 | `URL.createObjectURL(blob)` 产生的 `blob:` 链接，需额外处理 |

**策略 2：流媒体深度解析**

对于 HLS（.m3u8）：
- 获取 m3u8 文本内容，解析 master playlist（多清晰度）
- 解析 media playlist（ts 分片列表）
- 提取带宽、分辨率、编解码信息
- 对加密流（AES-128 / SAMPLE-AES）记录密钥获取方式

对于 DASH（.mpd）：
- 通过 dash.js 解析 MPD 文件
- 提取 AdaptationSet（不同清晰度/编码）
- 提取 SegmentTemplate 或 SegmentList 中的分片信息
- 支持 BaseURL + SegmentTemplate 组合模式

**策略 3：DOM 扫描**

- `MutationObserver` 持续监听新增的 `<video>`、`<source>`、`<iframe>` 元素
- 对 `<iframe>` 嵌套页面递归检测（受同源策略限制）
- 拦截 `URL.createObjectURL` 获取 blob 视频引用

### 去重机制

每个检测到的视频生成唯一指纹：`hash(videoUrl + quality + type)`，同一视频不会重复出现在列表中。

### 视频信息结构

```typescript
interface DetectedVideo {
  id: string;                    // 唯一指纹
  url: string;                   // 视频地址
  title: string;                 // 智能命名结果
  format: 'mp4' | 'mkv' | 'flv' | 'avi' | 'rmvb' | 'rm' | 'webm' | 'mov' | 'ts' | 'hls' | 'dash' | 'blob';
  mimeType: string;              // Content-Type
  size?: number;                 // 文件大小（如果能获取）
  width?: number;                // 视频宽度
  height?: number;               // 视频高度
  duration?: number;             // 时长（秒）
  bitrate?: number;              // 码率
  source: 'network' | 'dom' | 'blob';  // 检测来源
  pageUrl: string;               // 来源页面 URL
  domain: string;                // 来源域名
  segments?: string[];           // HLS/DASH 分片 URL 列表
  encryption?: {                 // 加密信息
    method: string;
    keyUrl?: string;
  };
  detectedAt: number;            // 检测时间戳
}
```

## 功能 2：下载管理

### 下载队列

```
用户点击下载
    │
    ▼
┌─────────────┐
│  下载队列    │ ← 并发控制（用户可配置，默认 3）
│  (优先级)    │
└──────┬──────┘
       │
       ├─ 常规视频 → Chrome Downloads API
       │
       ├─ HLS 视频 → Content Script 提取 ts 分片 → 合并下载
       │              ├─ 单线程顺序下载所有分片
       │              └─ 合并为 mp4（ffmpeg.wasm 或直接拼接 ts）
       │
       ├─ DASH 视频 → Content Script 提取分片 → 合并下载
       │              ├─ 分别下载音视频轨
       │              └─ 可选 ffmpeg.wasm 合并音视频
       │
       └─ Blob 视频 → Content Script 拦截 blob 数据 → 转为可下载链接
```

### 并发设置

```typescript
interface DownloadSettings {
  maxConcurrent: number;      // 最大并发数，默认 3，范围 1-5
  retryCount: number;         // 失败重试次数，默认 3
  retryDelay: number;         // 重试间隔（毫秒），默认 1000
  timeout: number;            // 单个请求超时（毫秒），默认 30000
  chunkSize?: number;         // 流媒体分片下载时的分块大小
}
```

### 下载任务状态

```typescript
interface DownloadTask {
  id: string;
  video: DetectedVideo;
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'paused';
  progress: number;           // 0-100
  speed: number;              // 字节/秒
  downloadedBytes: number;
  totalBytes: number;
  filePath?: string;          // 实际保存路径
  error?: string;
  downloader: 'chrome' | 'idm' | 'aria2' | 'motrix' | 'custom';
  startedAt?: number;
  completedAt?: number;
}
```

### 外部下载器集成

| 下载器 | 集成方式 | 说明 |
|--------|---------|------|
| IDM | `ExtIDM` 协议 / 命令行 | 需用户安装 IDM，通过 `idm://` 协议唤起 |
| aria2 | aria2 RPC（基于 WebSocket 的 JSON-RPC） | 需本地运行 aria2，通过 RPC 接口发送下载任务 |
| Motrix | aria2 兼容 RPC | Motrix 内置 aria2 兼容接口 |
| 自定义命令 | Native Messaging | 通过 Native Messaging Host 调用本地命令 |

用户在设置中选择默认下载器。对于流媒体（HLS/DASH），仅支持内置下载器（需要 Content Script 配合提取分片）。

### 文件保存策略

```
用户设置的基础目录/
├── {域名}/                       # 按域名分类（可关闭）
│   ├── {智能命名}.mp4
│   └── {智能命名}.mkv
├── {自定义规则}/                  # 用户自定义规则
│   └── ...
└── ...
```

注意：Chrome Downloads API 无法直接指定子目录。实现方式是在下载时通过 `chrome.downloads.download()` 的 `filename` 参数设置相对路径，用户在浏览器设置中指定默认下载目录作为基础目录。

## 功能 3：视频预览

### 预览模式

| 模式 | 触发方式 |
|------|---------|
| SidePanel 内嵌预览 | 点击 SidePanel 视频列表中的播放按钮 |
| 新标签页预览 | 右键菜单 / "在新标签页打开"按钮 |

### 预览能力

| 视频类型 | 预览方式 |
|---------|---------|
| 常规视频（mp4 等） | 直接将 URL 赋给 `<video src>`，浏览器原生解码 |
| HLS 流媒体 | 使用 HLS.js 将 m3u8 绑定到 `<video>` 元素，支持清晰度切换 |
| DASH 流媒体 | 使用 dash.js 将 mpd 绑定到 `<video>` 元素 |
| Blob 视频 | 直接使用 blob URL 播放 |

### 智能预览策略

- 预览时不下载完整视频，仅通过流式播放
- HLS.js / dash.js 仅请求用户当前播放位置附近的分片
- 预览窗口关闭时释放资源，不影响后台下载队列

### 预览页面布局

```
┌─────────────────────────────────────┐
│  SidePanel / 新标签页预览页面        │
│                                     │
│  ┌───────────────────────────────┐  │
│  │        视频播放器区域          │  │
│  │     (HTML5 <video> 元素)      │  │
│  │                               │  │
│  │  ┌─────┐            ┌──────┐ │  │
│  │  │ ◀ ▶ │  03:21/12:45 │ ⛶ │ │  │
│  │  └─────┘            └──────┘ │  │
│  └───────────────────────────────┘  │
│                                     │
│  视频信息面板                        │
│  ├─ 标题: xxx                       │
│  ├─ 格式: HLS 1080p                │
│  ├─ 大小: ~156 MB                  │
│  └─ 来源: hanpian.top              │
│                                     │
│  [ 下载 ]  [ 在新标签页打开 ]        │
│                                     │
└─────────────────────────────────────┘
```

## 功能 4：智能命名

### 命名优先级（从高到低）

```
优先级 1: 页面 <title> 标签
    ↓ 如果是乱码或纯数字
优先级 2: Open Graph 标签（og:title / og:video:title）
    ↓ 如果不存在或无效
优先级 3: 页面 <h1> 标签文本
    ↓ 如果不存在
优先级 4: <video> 元素附近文本（同级 / 父级文本节点）
    ↓ 如果提取失败
优先级 5: URL 路径解析（从 URL 中提取有意义的文件名）
    ↓ 如果是 hash/纯数字
优先级 6: "{域名}_{时间戳}" 兜底（如 hanpian_20260512_203000.mp4）
```

### 乱码检测逻辑

```typescript
function isGarbled(text: string): boolean {
  // 纯数字且超过 4 位 → 视为 ID 而非名称
  if (/^\d{4,}$/.test(text)) return true;

  // 长十六进制字符串（常见于 hash URL）
  if (/^[0-9a-f]{16,}$/i.test(text)) return true;

  // URL 编码比例过高
  const encodedRatio = (text.match(/%[0-9a-f]{2}/gi) || []).length / text.length;
  if (encodedRatio > 0.3) return true;

  // Unicode 乱码检测（大量连续不可见字符）
  const garbledRatio = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length / text.length;
  if (garbledRatio > 0.2) return true;

  return false;
}
```

### 名称清洗

```typescript
function sanitizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')              // 合并多余空格
    .replace(/[\\/:*?"<>|]/g, '_')      // 替换文件系统非法字符
    .replace(/\.{2,}/g, '.')            // 合并多余点号
    .replace(/^\.+|\.+$/g, '')          // 去除首尾点号
    .substring(0, 200);                 // 截断过长名称
}
```

### 自定义命名模板

用户可在设置中自定义命名模板，支持以下变量：

| 变量 | 说明 |
|------|------|
| `{name}` | 智能识别的名称 |
| `{domain}` | 来源域名 |
| `{date}` | 下载日期 |
| `{resolution}` | 分辨率（如 1080p） |
| `{format}` | 视频格式 |

默认模板：`{name}.{format}`

## 功能 5：黑名单与过滤

### 黑名单系统

```typescript
interface BlacklistRule {
  id: string;
  pattern: string;             // 域名或 URL 匹配模式
  type: 'domain' | 'url' | 'regex';  // 匹配类型
  reason?: string;             // 备注（如 "广告追踪"）
  enabled: boolean;
}
```

匹配黑名单规则的视频默认隐藏。UI 提供开关可切换显示被过滤的项（标记为"已过滤"）。

预置常见广告/追踪域名为默认黑名单：
- doubleclick.net
- googlesyndication.com
- adnxs.com
- adservice.google.com

### 过滤选项（细粒度）

提供多维度过滤条件，用户可自由组合：

| 过滤维度 | 可选项 | 说明 |
|---------|--------|------|
| **格式** | mp4, mkv, webm, flv, hls, dash, 其他 | 勾选想看到的格式 |
| **分辨率** | ≥4K, 1080p, 720p, 480p, 360p, 不限 | 最低分辨率过滤 |
| **大小** | >10MB, >50MB, >100MB, >500MB, 不限 | 最小文件大小过滤 |
| **时长** | >1分钟, >5分钟, >10分钟, >30分钟, 不限 | 最小时长过滤 |
| **来源** | 自动显示所有检测到的域名，可勾选 | 按来源域名过滤 |
| **类型** | 常规视频, 流媒体, Blob, 全部 | 按检测类型过滤 |

### 排序选项

- 按检测时间（最新优先）
- 按文件大小（最大优先）
- 按分辨率（最高优先）
- 按时长（最长优先）

### 持久化

所有过滤设置和黑名单通过 `chrome.storage.local` 保存，刷新页面后自动恢复。

## 功能 6：高度可定制的界面

### 三个 UI 入口

| 入口 | 触发方式 | 用途 |
|------|---------|------|
| **Popup** | 点击扩展图标 | 快速查看当前页检测到的视频、一键下载、快速预览 |
| **SidePanel** | 扩展图标右键 / 快捷键 | 大屏详细视图：视频列表 + 过滤 + 预览 + 批量操作 |
| **Options** | 扩展右键菜单 → 选项 | 全部设置：下载管理、黑名单、命名规则、主题、下载器配置等 |

### Popup 快速面板

```
┌──────────────────────────────┐
│  视频下载器              [⚙]  │
├──────────────────────────────┤
│  当前页: hanpian.top          │
│  检测到 3 个视频              │
│                              │
│  ┌──────────────────────────┐│
│  │ ▶ 斗罗大陆_第120集      ││
│  │   HLS 1080p  ~156MB      ││
│  │   [预览] [下载]          ││
│  └──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │ ▶ 斗罗大陆_第119集      ││
│  │   HLS 720p   ~89MB       ││
│  │   [预览] [下载]          ││
│  └──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │ ▶ 斗罗大陆_第118集      ││
│  │   mp4 720p   ~120MB      ││
│  │   [预览] [下载]          ││
│  └──────────────────────────┘│
│                              │
│  [全部下载]    [打开详细面板]  │
└──────────────────────────────┘
```

### 可定制项

| 定制维度 | 选项 |
|---------|------|
| **主题** | 亮色 / 暗色 / 跟随系统 |
| **主题色** | 预设 6-8 种主题色（蓝、绿、紫、橙、红、青、灰、自定义） |
| **语言** | 中文 / English（可扩展） |
| **Popup 宽度** | 窄（320px）/ 标准（400px）/ 宽（500px） |
| **列表密度** | 紧凑模式 / 标准模式 / 详细模式 |
| **显示信息列** | 勾选想看到的列：格式、大小、分辨率、时长、来源域名、检测时间 |
| **快捷键** | 自定义：打开 Popup、下载全部、打开 SidePanel 等 |
| **通知** | 下载完成通知（开/关）、声音提醒（开/关） |
| **自动清理** | 设置多少天后的下载记录自动清除 |

### 主题切换

基于 Ant Design 的 ConfigProvider + CSS Variables 实现运行时主题切换，无需重新加载页面：

```typescript
// 紧凑模式
compact: { fontSize: 12, padding: '4px 8px' }

// 标准模式
standard: { fontSize: 14, padding: '8px 12px' }

// 详细模式
detailed: { fontSize: 14, padding: '12px 16px', showExtraInfo: true }
```

### 右键菜单集成

- 页面右键 → "检测此页视频"
- 视频元素右键 → "下载此视频" / "预览此视频"
- 链接右键 → "下载链接中的视频"（如果是视频链接）

## 项目结构

```
video-downloader/
├── plasmo.json                    # Plasmo 配置
├── package.json
├── tsconfig.json
├── tailwind.config.ts             # Tailwind CSS 配置
│
├── src/
│   ├── background/                # Service Worker
│   │   ├── index.ts               # 入口：消息路由
│   │   ├── download-manager.ts    # 下载队列与并发控制
│   │   ├── settings.ts            # 设置管理（读写 chrome.storage）
│   │   └── external-downloader.ts # 外部下载器适配层
│   │
│   ├── content/                   # Content Script
│   │   ├── index.ts               # 入口：初始化检测器
│   │   ├── network-interceptor.ts # XHR/Fetch hook 拦截
│   │   ├── dom-observer.ts        # MutationObserver 监听 video/source
│   │   ├── hls-parser.ts          # m3u8 解析（基于 HLS.js）
│   │   ├── dash-parser.ts         # MPD 解析（基于 dash.js）
│   │   ├── blob-handler.ts        # Blob URL 视频处理
│   │   └── name-detector.ts       # 智能命名提取
│   │
│   ├── popup/                     # Popup 页面
│   │   ├── index.tsx
│   │   └── components/
│   │       ├── VideoList.tsx
│   │       └── VideoItem.tsx
│   │
│   ├── sidepanel/                 # SidePanel 页面
│   │   ├── index.tsx
│   │   └── components/
│   │       ├── VideoList.tsx
│   │       ├── VideoItem.tsx
│   │       ├── FilterPanel.tsx
│   │       ├── PreviewPlayer.tsx
│   │       └── BatchActions.tsx
│   │
│   ├── options/                   # Options 设置页
│   │   ├── index.tsx
│   │   └── components/
│   │       ├── DownloadSettings.tsx
│   │       ├── BlacklistManager.tsx
│   │       ├── NamingSettings.tsx
│   │       ├── AppearanceSettings.tsx
│   │       └── ExternalDownloaderSettings.tsx
│   │
│   ├── preview/                   # 新标签页预览页
│   │   ├── index.tsx
│   │   └── components/
│   │       └── FullPlayer.tsx
│   │
│   ├── store/                     # Zustand 状态管理
│   │   ├── video-store.ts         # 检测到的视频列表
│   │   ├── download-store.ts      # 下载任务状态
│   │   └── settings-store.ts      # 全局设置
│   │
│   ├── types/                     # TypeScript 类型定义
│   │   └── index.ts
│   │
│   ├── utils/                     # 工具函数
│   │   ├── sanitize.ts            # 文件名清洗
│   │   ├── format.ts              # 大小/时长格式化
│   │   └── storage.ts             # chrome.storage 封装
│   │
│   └── assets/                    # 图标、样式
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
└── docs/
    └── superpowers/specs/         # 设计文档
```

## 核心依赖

| 包名 | 用途 |
|------|------|
| `plasmo` | 扩展开发框架 |
| `react` + `react-dom` | UI 框架 |
| `antd` | UI 组件库 |
| `zustand` | 状态管理 |
| `hls.js` | HLS 流媒体解析与播放 |
| `dashjs` | DASH 流媒体解析与播放 |
| `dayjs` | 日期处理（轻量） |

## 开发与构建

```bash
# 开发（HMR 热更新）
pnpm dev          # Plasmo 自动打开 Chrome 并加载扩展

# 生产构建
pnpm build        # 输出到 build/ 目录，可直接加载或打包为 zip
```

## 测试参考网站

示例网站：
https://www.hanpian.top/yun/21923/1/4/
https://www.85po.com/v/3596/japanese-jk/
https://xhamster.com/videos/insta-live-11149445