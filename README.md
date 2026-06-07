# Video Downloader

Chrome MV3 扩展，自动检测网页中的视频/音频资源并下载。

## 功能特性

- **多格式支持**: MP4, WebM, MKV, HLS (m3u8), DASH (mpd), Blob URL, MP3, M4A, AAC, FLAC, OGG 等
- **智能检测**: Hook XHR/Fetch、DOM 扫描、Blob 捕获、m3u8/DASH 解析，多重检测手段全覆盖
- **HLS 下载**: m3u8 分片并行下载、AES-128 解密、TS→fMP4 转封装 (mux.js)
- **多层级降级**: 4 层下载降级策略，应对 CORS/Referer 等限制
- **外部下载器**: 支持 aria2、IDM、Motrix 及自定义 RPC/命令行下载器
- **批量操作**: 批量选择、批量下载、按页面/格式过滤
- **下载历史**: 完整的下载记录、进度追踪、失败重试
- **File System Access API**: 选择本地目录直接写入，无需浏览器下载栏
- **智能命名**: 自动检测页面标题 (og:title → title → h1 → URL)，自定义命名模板
- **黑名单**: 过滤广告/追踪域名，支持 domain/url/regex 三种匹配模式
- **Context Menu**: 右键菜单一键检测/下载页面视频
- **多入口 UI**: Popup 弹窗、SidePanel 侧边栏、Options 设置页、Preview 预览播放器

## 安装

### 从源码加载 (开发者模式)

1. 克隆仓库:
   ```bash
   git clone <repo-url>
   cd video-downloader
   pnpm install
   pnpm build
   ```

2. 打开 Chrome，进入 `chrome://extensions`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择 `build/chrome-mv3-prod/` 目录

### 开发模式

```bash
pnpm install
pnpm dev
```

然后在 `chrome://extensions` 加载 `build/chrome-mv3-dev/` 目录。

## 使用

1. **浏览网页**: 扩展自动检测页面中的视频/音频资源
2. **查看列表**: 点击扩展图标，在 Popup 中查看检测到的视频
3. **下载视频**: 点击下载按钮，选择下载器 (Chrome 原生 / aria2 / IDM / Motrix)
4. **预览播放**: 点击播放按钮在 Popup 内或新标签页预览
5. **批量下载**: 切换到 SidePanel 使用过滤和批量操作
6. **右键菜单**: 在视频页面右键 → "检测此页视频" / "下载此视频"

## 开发

```bash
pnpm dev          # 开发模式 (热重载)
pnpm build        # 生产构建
pnpm clean        # 清理构建产物
pnpm test         # 运行测试
pnpm test:watch   # 测试监视模式
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Plasmo 0.90.x (Chrome Extension) |
| 语言 | TypeScript 5.6 |
| UI | React 18 + Ant Design 5 + Zustand 5 |
| 视频处理 | mux.js 6, hls.js, dashjs |
| 构建 | Plasmo 内置 (SWC + ESBuild) |
| 测试 | Vitest 4 + @testing-library/react |
| 包管理 | pnpm |

### 项目结构

```
src/
├── background/      # Service Worker (消息路由、下载管理、HLS 下载)
├── content/         # Content Script MAIN world (视频检测主路径)
├── contents/        # Content Script ISOLATED world (消息中转)
├── popup/           # Popup 弹窗 UI
├── sidepanel/       # 侧边栏 UI
├── options/         # 设置页 UI
├── tabs/preview/    # 预览播放器
├── store/           # Zustand 状态管理
├── utils/           # 工具函数 (注入脚本、存储、格式化)
├── types/           # TypeScript 类型定义
└── __tests__/       # Vitest 单元测试

assets/              # Offscreen Document + Save Helper (纯 JS)
```

## Chrome 权限

`downloads, storage, sidePanel, contextMenus, activeTab, tabs, scripting, alarms, offscreen, declarativeNetRequest`

host_permissions: `<all_urls>`

## License

MIT
