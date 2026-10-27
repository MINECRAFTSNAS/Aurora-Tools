# Aurora Tools

视频解析下载 / 音频提取工具，配合 **Aurora Player** 使用。

打包为独立的 `.exe`，内置 yt-dlp 与 ffmpeg，**开箱即用，无需安装任何依赖，可完全离线运行**。

---

## ⚠️ 使用须知（请先阅读）

本工具只是 **yt-dlp 的图形界面外壳**，它不包含也不实现任何绕过技术。

- ✅ **可以**用于：下载你拥有版权的内容、已获授权的内容、明确允许下载的内容、无版权限制的素材（如 CC 授权影片）
- ❌ **不可**用于：绕过付费墙、会员限制、DRM 保护、访问控制，或任何违反目标站点服务条款与当地法律的行为
- 使用本工具下载的内容，其**版权责任由使用者自行承担**

工具不会、也无法破解任何加密保护。如果某个内容需要登录、付费或受 DRM 保护，你会在日志里看到明确的失败原因，而不是被悄悄绕过。

---

## 功能

| 功能 | 说明 |
|---|---|
| **链接解析** | 粘贴视频页面链接，解析标题、作者、时长、封面与全部可用格式 |
| **格式选择** | 列出每一档清晰度（含编码、帧率、体积），可选"最佳画质"自动择优 |
| **仅提取音频** | 从视频中抽出音轨，转成 MP3 / M4A / FLAC / WAV / Opus / OGG |
| **本地视频抽音轨** | 常驻显示，无需先解析链接；直接选本地视频文件（mp4/mkv/webm/avi/mov 等），走 ffmpeg 不联网 |
| **拖放导入** | 把文件 / 文件夹 / 链接直接拖进窗口：媒体文件进「本地提取」，文件夹递归展开，链接自动解析 |
| **自动合并** | 高清格式常为纯视频流，会自动配上最佳音轨合并成完整文件 |
| **元数据嵌入** | 自动写入标题、作者，并把封面图嵌入文件（播放器里能直接看到） |
| **任务队列** | 多任务并发下载、进度/速度/剩余时间实时显示、可取消可重试 |
| **实时日志** | 每个任务可展开查看 yt-dlp 原始输出，便于排查问题 |
| **失败提示** | 把 yt-dlp 的英文报错翻译成人话（不可用 / 需会员 / 403 / 超时等） |
| **悬停提示** | 所有按钮悬停显示用途说明，提示层独立渲染，不会被面板裁切 |

### 与 Aurora Player 配合

下载的音频默认保存到 `视频\Aurora Tools` 目录（可在设置里更改）。
任务完成后点「**播放**」按钮即可用系统默认播放器打开——如果已安装 Aurora Player 并关联了音频格式，就会直接在 Aurora Player 中播放，然后把它拖进播放列表即可。

---

## 快速开始

1. 运行 `Aurora Tools-Setup-1.0.0.exe` 安装，或直接运行 `Aurora Tools-1.0.0-portable.exe`（免安装）
2. 把视频链接粘贴到顶部输入框，回车
3. 选清晰度（或切到「仅音频」标签选择格式），点击下载
4. 下载完成后点「播放」或「打开位置」

---

## 构建

```powershell
# 安装依赖
npm install

# 完整构建（图标 + 类型检查 + 编译 + 打包）
pwsh -File scripts/build.ps1

# 跳过图标重新生成
pwsh -File scripts/build.ps1 -SkipIcon

# 开发模式（热重载）
npm run dev
```

产物位于 `release/`：

- `Aurora Tools-Setup-1.0.0.exe` — NSIS 安装包（可选安装目录、创建快捷方式）
- `Aurora Tools-1.0.0-portable.exe` — 单文件免安装版

---

## 测试

```powershell
# 1) 冒烟测试：UI 结构 + 工具自检 + 真实 ffmpeg 抽音轨 + 错误处理（19 项）
.\node_modules\electron\dist\electron.exe scripts\smoke.cjs

# 加上网络解析测试（20 项）
.\node_modules\electron\dist\electron.exe scripts\smoke.cjs --online

# 2) 端到端真实下载：解析 → 下载 → 转码 → ffprobe 校验产物（7 项）
node scripts\e2e-download.cjs

# 3) 打包产物验证：启动真实 exe，验证内置工具在打包后仍可用（26 / 22 项）
node scripts\verify-packaged.cjs unpacked
node scripts\verify-packaged.cjs portable

# 4) 图标像素校验（12 项）
python scripts\check_icon.py

# 5) 界面交互回归（21 项）：本地提取常驻、下拉框不被遮挡、格式/比特率即时生效、窗口按钮不重复
node scripts\verify-fixes.cjs

# 6) 「仅音频」标签页专项（13 项）：用本地 HTTP 直链喂给 yt-dlp，不依赖外网
node scripts\verify-audio-tab.cjs

# 7) 拖放导入回归（12 项）：真实拖拽事件、文件夹递归、链接自动解析、实际产出音频
node scripts\verify-dnd.cjs

# 8) 产物路径解析单测（14 项）：用真实 yt-dlp 输出行验证合并/转封装/提取音频的路径
node scripts\verify-parser.cjs

# 9) 视频产物端到端（8 项）：本地 mkv 强制走 remux，断言记录的产物真实存在
.\node_modules\electron\dist\electron.exe scripts\verify-video-artifact.cjs
```

> 测试用的网络素材为 **Big Buck Bunny**（Blender 基金会，CC-BY 授权），允许自由下载分发。
> `verify-audio-tab.cjs` 与 `verify-fixes.cjs` 中的解析断言使用本机临时 HTTP 服务提供的短视频，
> 因此即使视频站点触发风控（反机器人）也能稳定运行。
> `e2e-download.cjs` 依赖外网；若本机对 YouTube 有 SSL 拦截/风控，它会失败，属环境问题。

---

## 内置二进制

| 文件 | 版本 | 大小 |
|---|---|---|
| `yt-dlp.exe` | 2026.08.19 | 17.01 MB |
| `ffmpeg.exe` | N-126308-gd411d9e752 | 0.52 MB |
| `ffprobe.exe` | N-126308-gd411d9e752 | 0.22 MB |

位于 `resources/bin/`，打包时通过 `extraResources` 复制到安装目录的 `resources/bin/`。
主进程用 `process.resourcesPath` 在打包后定位，开发态回退到仓库路径。

---

## 实现要点

### 进程封装（`src/main/ytdlp.ts`）

- **进度解析**：yt-dlp 的 `--newline` 让进度逐行输出（而不是用 `\r` 原地刷新），
  再按 `\r\n` / `\r` / `\n` 三种分隔符切分，兼容不同版本行为
- **取消**：Windows 上用 `taskkill /pid <pid> /t /f` 连带结束 ffmpeg 孙子进程，
  否则残留进程会占住输出文件导致后续任务失败
- **错误翻译**：把 `ERROR:` 行按常见模式映射成中文可读原因
- **产物路径要看"最后一步"**：一次下载的产物可能被改写多次 ——
  `[download] Destination:`（中间文件）→ `[Merger]`（合并产物）→ `[VideoRemuxer]`（转封装后的真正成品）。
  每前一步的文件都会被 yt-dlp 删掉。只解析 `[Merger]` 会导致任务里存着已删除的 `.mkv`，
  表现为**下载完成但点播放提示"文件不存在"**。
  现在同时解析 `[VideoRemuxer]` / `[VideoConvertor]` 等后处理行，并在任务完成时做一次兜底：
  若记录的路径不存在，就在下载目录里找本任务新产生、名字匹配标题的文件

### 界面实现要点

- **设置必须回写 React state**：`<select value={settings.audioFormat}>` 这类受控组件，
  如果 `onChange` 只调用 `window.tools.setSettings()` 而不更新父组件的 `settings` state，
  React 会立刻把 DOM 值重置回旧值 —— 表现为"选了没反应，重启后才生效"（因为磁盘上的设置确实改了）。
  正确做法是统一走 `onChangeSettings → changeSettings → setSettings(next)`，先写盘再 `setState`
- **下拉框不用原生 `<select>`**：在透明/亚克力无边框窗口里，原生的下拉弹层由系统单独绘制，
  层级不受页面控制，实测会被窗口背景遮住。改为自绘 `Dropdown`，浮层通过 portal 渲染到
  `document.body`（`position: fixed`，`z-index: 99998`）
- **悬停提示不用 `::after`**：伪元素会被祖先的 `overflow: hidden/auto` 整个裁掉。
  统一由 `TooltipLayer` 在 body 上渲染 `position: fixed` 的提示层（`z-index: 99999`），
  并按视口边界收敛，避免贴边按钮的提示溢出屏幕
- **无边框窗口**：`frame: false` + 渲染层自绘标题栏。少了这一项，系统原生标题栏会和
  自绘按钮同时出现，形成两套最小化/最大化/关闭按钮
- **拖放取路径**：Electron 32+ 已移除 `File.path`，必须用 `webUtils.getPathForFile(file)`
  （且只能在 preload 里调用）。另外 **`dataTransfer` 在 drop 回调返回后即失效**，
  所以文件列表和 `getData('text/plain')` 都必须在任何 `await` 之前同步取完，
  否则异步展开路径后读到的是空值
- **文件夹递归**：拖入目录时在主进程递归扫描，限制了深度（4 层）与数量（2000 个），
  避免误拖整个磁盘时卡死；非媒体扩展名直接过滤

### 打包相关

- **`portable.unpackDirName` 必须设置**：默认的随机后缀临时目录会导致 portable 版
  启动后没有窗口（进程活着但 `MainWindowHandle=0`）。固定解包目录名后正常
- **`ELECTRON_RUN_AS_NODE` 环境变量必须清除**：若该变量存在，Electron 会以纯 Node 模式启动，
  `require('electron')` 返回的是 npm CLI 的 shim 字符串，`app` 为 `undefined`，应用直接退出 1。
  构建与启动脚本里都做了清除
- **`edit`/`write` 时的 CJS 互操作**：electron-vite 打包 CJS 时 `import { app } from 'electron'`
  会被编译成对 `__toESM` 包装对象的属性访问，导致 `app` 为 `undefined`。
  必须写成 `import electron from 'electron'` 再解构

### 已知限制

- 需要登录 / 会员 / DRM 保护的内容无法下载（这是设计如此，不是缺陷）
- 部分站点的反爬策略（要求 Cookies 验证）会失败，可在设置里配置代理
- 打包体积约 95 MB，主要来自 Electron 运行时；实际工具链仅 17.8 MB
- 仅支持 Windows

---

## 设置项

| 设置 | 默认值 | 说明 |
|---|---|---|
| 下载目录 | `视频\Aurora Tools` | 输出位置 |
| 音频格式 | MP3 | MP3 / M4A / FLAC / WAV / Opus / OGG |
| 音频比特率 | 192k | 无损格式忽略此项 |
| 视频容器 | MP4 | MP4 / MKV / WebM / 跟随源 |
| 并发数 | 2 | 同时下载的任务数 |
| 重试次数 | 5 | 网络失败自动重试 |
| 限速 | 不限 | 如 `2M` 表示最高 2MB/s |
| 嵌入封面/元数据 | 开 | 写入标题、作者、封面图 |
| 只下载单个视频 | 开 | 忽略播放列表，避免误下整个合集 |
| 使用代理 | 关 | `http://` 或 `socks5://` 地址 |

---

## 项目结构

```
aurora-tools/
├── resources/bin/          # 内置 yt-dlp / ffmpeg / ffprobe
├── src/
│   ├── main/
│   │   ├── index.ts        # 窗口、IPC、任务队列、本地抽音轨
│   │   └── ytdlp.ts        # 进程封装、进度解析、错误翻译
│   ├── preload/index.ts    # contextBridge 暴露的 25 个方法
│   ├── shared/types.ts     # 主/渲染共享类型与默认设置
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── components/ # ProbePanel / QueuePanel / SettingsPanel / Icons
│           ├── styles/     # global / win11 / app
│           └── utils/format.ts
└── scripts/
    ├── build.ps1           # 一键构建
    ├── smoke.cjs           # 冒烟测试
    ├── e2e-download.cjs    # 端到端真实下载测试
    ├── verify-packaged.cjs # 打包产物验证
    ├── make_icon.py        # 生成多尺寸 ico
    └── check_icon.py       # 图标像素校验
```

## 技术栈

Electron 33 · electron-vite 2 · React 18 · TypeScript 5.7 · electron-builder 25
