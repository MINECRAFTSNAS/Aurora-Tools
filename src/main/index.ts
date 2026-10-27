/**
 * 主进程：窗口、IPC、任务队列。
 *
 * 所有下载都通过 yt-dlp 子进程执行，任务状态在主进程维护，
 * 通过 IPC 事件推送到渲染层。
 */
import electron from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fsp } from 'node:fs'
import { join, basename, dirname, extname, resolve } from 'node:path'
import {
  AUDIO_BITRATES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type FormatInfo,
  type Job,
  type JobKind,
  type MediaInfo,
  type ToolInfo
} from '../shared/types'
import {
  humanizeError,
  isPostProcessLine,
  parseDestination,
  parseDownloadLine,
  resolveBinDir,
  runCapture,
  spawnStream,
  type BinPaths,
  type SpawnHandle
} from './ytdlp'

const { app, BrowserWindow, dialog, ipcMain, shell } = electron

type MainWindow = Electron.BrowserWindow
type OpenDialogOptions = Electron.OpenDialogOptions

let mainWindow: MainWindow | null = null
let bin: BinPaths
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let settingsPath = ''
let toolInfo: ToolInfo = { ytdlp: false, ffmpeg: false, binDir: '' }

/** 任务表：id -> Job */
const jobs = new Map<string, Job>()
/** 运行中的子进程：id -> handle */
const running = new Map<string, SpawnHandle>()
/** 排队等待的任务 id */
const queue: string[] = []

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */
async function loadSettings(): Promise<void> {
  try {
    const raw = await fsp.readFile(settingsPath, 'utf-8')
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }
  if (!settings.downloadDir) {
    settings.downloadDir = join(app.getPath('videos'), 'Aurora Tools')
  }
}

let saveTimer: NodeJS.Timeout | null = null
function persistSettings(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8').catch(() => undefined)
  }, 200)
}

/* ------------------------------------------------------------------ *
 * 工具自检
 * ------------------------------------------------------------------ */
async function checkTools(): Promise<ToolInfo> {
  const info: ToolInfo = { ytdlp: false, ffmpeg: false, binDir: bin.binDir }

  if (!existsSync(bin.ytdlp)) {
    info.error = `未找到 yt-dlp.exe（期望位置：${bin.ytdlp}）`
    return info
  }

  const yt = await runCapture(bin.ytdlp, ['--version'], { timeoutMs: 30_000 })
  if (yt.code === 0) {
    info.ytdlp = true
    info.ytdlpVersion = yt.stdout.trim().split(/\r?\n/)[0]
  } else {
    info.error = `yt-dlp 无法运行：${yt.stderr.slice(0, 200)}`
  }

  if (existsSync(bin.ffmpeg)) {
    const ff = await runCapture(bin.ffmpeg, ['-version'], { timeoutMs: 20_000 })
    if (ff.code === 0) {
      info.ffmpeg = true
      // "ffmpeg version N-126308-... Copyright ..."
      const m = /ffmpeg version (\S+)/.exec(ff.stdout)
      info.ffmpegVersion = m ? m[1] : 'unknown'
    }
  }

  toolInfo = info
  console.log('[tools]', JSON.stringify(info))
  return info
}

/* ------------------------------------------------------------------ *
 * 公共参数
 * ------------------------------------------------------------------ */
function commonArgs(): string[] {
  const args: string[] = [
    '--no-warnings',
    '--no-colors',
    '--newline', // 进度逐行输出，便于解析
    '--ffmpeg-location',
    bin.binDir,
    '--retries',
    String(Math.max(0, settings.retries)),
    '--socket-timeout',
    '30'
  ]

  if (settings.noPlaylist) args.push('--no-playlist')
  if (settings.rateLimit) args.push('--limit-rate', settings.rateLimit)
  if (settings.useProxy && settings.proxyUrl) args.push('--proxy', settings.proxyUrl)

  // 不覆盖已存在文件，但允许断点续传
  args.push('--continue')

  return args
}

/* ------------------------------------------------------------------ *
 * 解析（--dump-single-json）
 * ------------------------------------------------------------------ */
interface RawFormat {
  format_id?: string
  ext?: string
  height?: number | null
  fps?: number | null
  abr?: number | null
  vbr?: number | null
  tbr?: number | null
  filesize?: number | null
  filesize_approx?: number | null
  vcodec?: string
  acodec?: string
  format_note?: string
  resolution?: string
  protocol?: string
}

interface RawInfo {
  id?: string
  title?: string
  uploader?: string
  channel?: string
  duration?: number
  thumbnail?: string
  extractor_key?: string
  extractor?: string
  description?: string
  upload_date?: string
  view_count?: number
  is_live?: boolean
  formats?: RawFormat[]
  entries?: RawInfo[]
  _type?: string
}

/** 把 yt-dlp 的原始 format 列表整理成可展示的选项 */
function normalizeFormats(raw: RawInfo): FormatInfo[] {
  const list = raw.formats ?? []
  const out: FormatInfo[] = []

  for (const f of list) {
    if (!f.format_id) continue
    // 跳过 storyboard（纯图片）
    if (f.ext === 'mhtml' || /storyboard/i.test(f.format_note ?? '')) continue
    // 跳过纯音频容器被标记为 video 的怪东西
    if (f.protocol === 'mhtml') continue

    const vcodec = f.vcodec && f.vcodec !== 'none' ? f.vcodec : undefined
    const acodec = f.acodec && f.acodec !== 'none' ? f.acodec : undefined
    const audioOnly = !vcodec && !!acodec
    const videoOnly = !!vcodec && !acodec

    const codecShort = vcodec ? vcodec.split('.')[0].replace(/^avc1$/, 'h264').replace(/^vp0?9$/, 'vp9') : undefined

    let label: string
    if (audioOnly) {
      const abr = f.abr ?? f.tbr
      label = `音频 ${abr ? Math.round(abr) + 'kbps' : ''} ${f.ext ?? ''}`.trim()
    } else {
      const res = f.height ? `${f.height}p` : (f.resolution ?? 'unknown')
      const fps = f.fps && f.fps > 30 ? `${Math.round(f.fps)}fps` : ''
      label = `${res}${fps ? ' ' + fps : ''} ${f.ext ?? ''}${codecShort ? ' (' + codecShort + ')' : ''}`.trim()
    }

    out.push({
      formatId: f.format_id,
      label,
      ext: f.ext ?? '',
      height: f.height ?? undefined,
      fps: f.fps ?? undefined,
      abr: f.abr ?? undefined,
      vbr: f.vbr ?? undefined,
      filesize: f.filesize ?? f.filesize_approx ?? undefined,
      audioOnly,
      videoOnly,
      vcodec,
      acodec,
      note: videoOnly ? '无音轨，下载时自动合并' : undefined
    })
  }

  // 排序：先按类型（视频优先合并可选），再按清晰度降序
  out.sort((a, b) => {
    if (a.audioOnly !== b.audioOnly) return a.audioOnly ? 1 : -1
    const ha = a.height ?? 0
    const hb = b.height ?? 0
    if (ha !== hb) return hb - ha
    return (b.filesize ?? 0) - (a.filesize ?? 0)
  })

  // 去重：同一 formatId 只留一个
  const seen = new Set<string>()
  return out.filter((f) => (seen.has(f.formatId) ? false : (seen.add(f.formatId), true)))
}

async function probe(url: string): Promise<MediaInfo> {
  const args = [
    ...commonArgs(),
    '--dump-single-json',
    '--skip-download',
    // 避免解析播放列表时产生巨大输出
    '--playlist-end',
    '1',
    '--no-check-certificates',
    url
  ]

  const res = await runCapture(bin.ytdlp, args, { timeoutMs: 180_000 })
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new Error(humanizeError(res.stderr || res.stdout))
  }

  let raw: RawInfo
  try {
    raw = JSON.parse(res.stdout) as RawInfo
  } catch {
    throw new Error('解析返回内容失败，可能该链接不是受支持的视频页面')
  }

  // 播放列表/合集：取第一个条目
  if (raw._type === 'playlist' && Array.isArray(raw.entries) && raw.entries.length > 0) {
    const first = raw.entries.find((e) => e && e.id)
    if (first) raw = { ...first, extractor: raw.extractor }
  }

  if (!raw.id && !raw.title) {
    throw new Error('未能获取视频信息，请确认链接有效')
  }

  return {
    url,
    id: raw.id ?? '',
    title: raw.title ?? '未命名',
    uploader: raw.uploader ?? raw.channel,
    duration: raw.duration,
    thumbnail: raw.thumbnail,
    extractor: raw.extractor ?? raw.extractor_key,
    description: raw.description ? raw.description.slice(0, 2000) : undefined,
    uploadDate: raw.upload_date,
    viewCount: raw.view_count,
    isLive: raw.is_live,
    formats: normalizeFormats(raw)
  }
}

/* ------------------------------------------------------------------ *
 * 构建下载参数
 * ------------------------------------------------------------------ */
function outputTemplate(): string {
  // 限制文件名长度并清理非法字符，避免 Windows 路径超限
  return join(settings.downloadDir, '%(title).120B [%(id)s].%(ext)s')
}

function buildVideoArgs(url: string, formatId: string): string[] {
  const args = [...commonArgs(), '--output', outputTemplate()]

  // 视频：优先用所选格式，若为纯视频则补最佳音轨；否则自动选最佳
  if (formatId) {
    args.push('-f', `${formatId}+bestaudio/${formatId}/best`)
  } else {
    args.push('-f', 'bestvideo+bestaudio/best')
  }

  if (settings.videoContainer !== 'auto') {
    args.push('--merge-output-format', settings.videoContainer)
    if (settings.videoContainer === 'mp4') {
      // 尽量选 mp4 兼容流，减少转封装失败
      args.push('--remux-video', 'mp4')
    }
  }

  if (settings.writeSubs) args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'zh-Hans,zh,en')
  if (settings.embedThumbnail) args.push('--embed-thumbnail')
  if (settings.embedMetadata) args.push('--embed-metadata')

  args.push(url)
  return args
}

function buildAudioArgs(url: string, formatId: string): string[] {
  const fmt = settings.audioFormat
  const args = [
    ...commonArgs(),
    '--output',
    outputTemplate(),
    // 只要音轨：优先所选音频格式，其次最佳音轨
    '-f',
    formatId ? `${formatId}/bestaudio/best` : 'bestaudio/best',
    '--extract-audio',
    '--audio-format',
    fmt
  ]

  const bitrates = AUDIO_BITRATES[fmt]
  if (bitrates.length > 0 && settings.audioBitrate) {
    args.push('--audio-quality', settings.audioBitrate + 'K')
  }

  if (settings.embedThumbnail) args.push('--embed-thumbnail')
  if (settings.embedMetadata) args.push('--embed-metadata')
  args.push(url)
  return args
}

/* ------------------------------------------------------------------ *
 * 任务执行
 * ------------------------------------------------------------------ */
function emitJob(job: Job): void {
  mainWindow?.webContents.send('job:update', job)
}

function updateJob(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id)
  if (!job) return
  Object.assign(job, patch)
  emitJob({ ...job })
}

function appendLog(id: string, line: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.log.push(line)
  // 只保留最近 400 行
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400)
}

function startJob(id: string): void {
  const job = jobs.get(id)
  if (!job) return

  updateJob(id, { status: 'downloading', percent: 0, error: undefined, log: [] })

  const isAudio = job.kind === 'audio'
  const formatId = job.targetFormatId ?? ''
  const args = isAudio ? buildAudioArgs(job.url, formatId) : buildVideoArgs(job.url, formatId)

  console.log('[job]', id, 'yt-dlp', args.join(' '))

  let sawPostProcess = false

  const handle = spawnStream(bin.ytdlp, args, {
    cwd: settings.downloadDir,
    onLine: (line) => {
      appendLog(id, line)

      const dest = parseDestination(line)
      if (dest) updateJob(id, { outputPath: dest })

      if (isPostProcessLine(line)) {
        sawPostProcess = true
        const current = jobs.get(id)
        // 合并/转码阶段没有百分比，用不确定状态表示
        if (current && current.status !== 'converting') {
          updateJob(id, { status: 'converting', percent: Math.max(current.percent, 99) })
        }
      }

      const p = parseDownloadLine(line)
      if (p) {
        const current = jobs.get(id)
        updateJob(id, {
          percent: p.percent,
          downloaded: p.downloaded,
          total: p.total,
          speed: p.speed,
          eta: p.eta,
          // 下载中途出现进度即视为仍在下载（多文件场景）
          status: sawPostProcess && p.percent >= 100 ? 'converting' : 'downloading'
        })
        if (current) void pushProgressToTaskbar(id)
      }
    },
    onExit: (code) => {
      running.delete(id)
      const job = jobs.get(id)
      if (!job) return

      if (job.status === 'canceled') {
        emitJob({ ...job })
        pumpQueue()
        return
      }

      if (code === 0) {
        // 产物路径再解析一次：输出里可能漏掉某个后处理行
        void finalizeDone(id)
      } else {
        const err = humanizeError(job.log.join('\n'))
        updateJob(id, { status: 'error', error: err, finishedAt: Date.now() })
        mainWindow?.webContents.send('job:failed', { ...job })
      }
      pumpQueue()
    }
  })

  running.set(id, handle)
}

/**
 * 任务成功后确定最终产物。
 *
 * yt-dlp 的产物可能被后处理反复改写（下载中间文件 → 合并 → 转封装 → 提取音轨），
 * 最后的文件名与中途打印的 Destination 未必一致，而且中间文件会被删掉。
 * 所以这里：
 *   1) 记录的路径存在 → 直接用
 *   2) 否则在下载目录里找"本任务开始后新产生"的文件，优先名字匹配标题
 *   3) 都不行就保留原值（让用户至少能打开目录自己找）
 */
async function finalizeDone(id: string): Promise<void> {
  const job = jobs.get(id)
  if (!job) return

  const resolved = await resolveOutputPath(job)
  updateJob(id, {
    status: 'done',
    percent: 100,
    finishedAt: Date.now(),
    speed: '',
    eta: '',
    outputPath: resolved ?? job.outputPath
  })
  const done = jobs.get(id)
  if (done) mainWindow?.webContents.send('job:done', { ...done })
}

/** 允许作为产物的扩展名（按优先级排序：先音视频成品，再其他） */
const ARTIFACT_EXTS = [
  '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m4v',
  '.mp3', '.m4a', '.flac', '.wav', '.opus', '.ogg', '.aac',
  '.jpg', '.png', '.webp', '.vtt', '.srt', '.ass'
]

async function resolveOutputPath(job: Job): Promise<string | undefined> {
  const recorded = job.outputPath
  if (recorded && existsSync(recorded)) return recorded

  const dir = settings.downloadDir
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return recorded
  }

  const since = (job.createdAt ?? 0) - 5000
  const found: { path: string; mtime: number; ext: string }[] = []

  for (const name of names) {
    // 跳过临时文件
    if (/\.(part|ytdl|temp|tmp)$/i.test(name)) continue
    const ext = extname(name).toLowerCase()
    if (!ARTIFACT_EXTS.includes(ext)) continue
    const full = join(dir, name)
    try {
      const st = await fsp.stat(full)
      if (st.isFile() && st.mtimeMs >= since) found.push({ path: full, mtime: st.mtimeMs, ext })
    } catch {
      /* 忽略不可读项 */
    }
  }

  if (found.length === 0) return recorded

  // 名字里含标题关键字的优先（截断避免标题过长/含特殊字符）
  const hint = (job.title ?? '').toLowerCase().replace(/[\\/:*?"<>|]/g, '').slice(0, 12)
  if (hint.length >= 2) {
    const byName = found.filter((f) => basename(f.path).toLowerCase().includes(hint))
    if (byName.length > 0) {
      byName.sort((a, b) => b.mtime - a.mtime)
      return byName[0].path
    }
  }

  // 退而求其次：最新的音视频文件（跳过封面/字幕）
  const media = found.filter((f) => !['.jpg', '.png', '.webp', '.vtt', '.srt', '.ass'].includes(f.ext))
  const pool = media.length > 0 ? media : found
  pool.sort((a, b) => b.mtime - a.mtime)
  return pool[0].path
}

let lastTaskbar = 0
async function pushProgressToTaskbar(id: string): Promise<void> {
  const now = Date.now()
  if (now - lastTaskbar < 400) return
  lastTaskbar = now
  const job = jobs.get(id)
  if (!mainWindow || !job) return
  if (settings.concurrency === 1) {
    mainWindow.setProgressBar(job.percent / 100)
  }
}

/** 从队列取任务运行，受并发数限制 */
function pumpQueue(): void {
  while (running.size < Math.max(1, settings.concurrency) && queue.length > 0) {
    const id = queue.shift()
    if (!id) break
    const job = jobs.get(id)
    if (!job || job.status !== 'queued') continue
    startJob(id)
  }

  if (running.size === 0 && queue.length === 0) {
    mainWindow?.setProgressBar(-1)
  }
}

/* ------------------------------------------------------------------ *
 * 本地文件时长探测（ffprobe）
 * ------------------------------------------------------------------ */
async function probeDuration(file: string): Promise<number> {
  if (!existsSync(bin.ffprobe)) return 0
  const res = await runCapture(
    bin.ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { timeoutMs: 30_000 }
  )
  const secs = Number.parseFloat(res.stdout.trim())
  return Number.isFinite(secs) && secs > 0 ? secs : 0
}

/* ------------------------------------------------------------------ *
 * 拖入路径展开（文件 / 文件夹）
 * ------------------------------------------------------------------ */
/** 可参与"抽音轨"的媒体扩展名 */
const MEDIA_EXTS = new Set([
  '.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.ts', '.mpg', '.mpeg', '.3gp', '.ogv',
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.aiff', '.ape'
])

const MAX_DROP_FILES = 2000
const MAX_DROP_DEPTH = 4

/**
 * 把拖入的路径展开成媒体文件列表。
 * 目录会递归扫描（限深度与数量，避免误拖整个磁盘时卡死）。
 */
async function expandMediaPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DROP_DEPTH || out.length >= MAX_DROP_FILES) return
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    // 名称排序，保证多次拖入的顺序稳定
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    for (const e of entries) {
      if (out.length >= MAX_DROP_FILES) return
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (e.isFile() && MEDIA_EXTS.has(extname(e.name).toLowerCase())) {
        out.push(full)
      }
    }
  }

  for (const raw of paths ?? []) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const p = raw.trim()
    const st = await fsp.stat(p).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) await walk(p, 0)
    else if (MEDIA_EXTS.has(extname(p).toLowerCase())) out.push(p)
  }

  return out
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */
function registerIpc(): void {
  ipcMain.handle('tools:check', () => checkTools())

  ipcMain.handle('tools:version', async () => {
    const t = await checkTools()
    return t
  })

  ipcMain.handle('media:probe', async (_e, url: string): Promise<MediaInfo> => {
    if (!toolInfo.ytdlp) await checkTools()
    if (!toolInfo.ytdlp) throw new Error(toolInfo.error ?? 'yt-dlp 不可用')
    const trimmed = String(url ?? '').trim()
    if (!/^https?:\/\//i.test(trimmed)) throw new Error('请输入以 http:// 或 https:// 开头的链接')
    return probe(trimmed)
  })

  ipcMain.handle('tools:expand-paths', async (_e, paths: string[]) => expandMediaPaths(paths))

  ipcMain.handle(
    'jobs:create',
    (
      _e,
      payload: { url: string; kind: JobKind; formatId?: string; title: string; target: string; durationSec?: number }
    ) => {
      const id = randomUUID()
      const job: Job = {
        id,
        kind: payload.kind,
        url: payload.url,
        title: payload.title,
        status: 'queued',
        percent: 0,
        downloaded: 0,
        total: 0,
        speed: '',
        eta: '',
        log: [],
        target: payload.target,
        targetFormatId: payload.formatId ?? '',
        durationSec: payload.durationSec,
        createdAt: Date.now()
      }
      jobs.set(id, job)
      queue.push(id)
      emitJob({ ...job })
      pumpQueue()
      return id
    }
  )

  ipcMain.handle('jobs:list', () => Array.from(jobs.values()).map((j) => ({ ...j })))

  ipcMain.handle('jobs:cancel', (_e, id: string) => {
    const job = jobs.get(id)
    if (!job) return false
    if (job.status === 'queued') {
      const idx = queue.indexOf(id)
      if (idx >= 0) queue.splice(idx, 1)
      updateJob(id, { status: 'canceled', finishedAt: Date.now() })
      return true
    }
    const handle = running.get(id)
    if (handle) {
      updateJob(id, { status: 'canceled', finishedAt: Date.now() })
      handle.kill()
      return true
    }
    return false
  })

  ipcMain.handle('jobs:retry', (_e, id: string) => {
    const job = jobs.get(id)
    if (!job) return false
    if (job.status !== 'error' && job.status !== 'canceled') return false
    job.status = 'queued'
    job.percent = 0
    job.error = undefined
    job.log = []
    job.speed = ''
    job.eta = ''
    job.finishedAt = undefined
    queue.push(id)
    emitJob({ ...job })
    pumpQueue()
    return true
  })

  ipcMain.handle('jobs:remove', (_e, id: string) => {
    const job = jobs.get(id)
    if (!job) return false
    const handle = running.get(id)
    if (handle) handle.kill()
    running.delete(id)
    jobs.delete(id)
    return true
  })

  ipcMain.handle('jobs:clear-finished', () => {
    for (const [id, job] of jobs) {
      if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
        jobs.delete(id)
      }
    }
    return Array.from(jobs.values()).map((j) => ({ ...j }))
  })

  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch }
    persistSettings()
    return settings
  })

  ipcMain.handle('dialog:pick-download-dir', async () => {
    const opts: OpenDialogOptions = {
      title: '选择下载目录',
      defaultPath: settings.downloadDir,
      properties: ['openDirectory', 'createDirectory']
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    settings.downloadDir = res.filePaths[0]
    persistSettings()
    return settings.downloadDir
  })

  ipcMain.handle('dialog:pick-video-file', async () => {
    const opts: OpenDialogOptions = {
      title: '选择本地视频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'mpg', 'mpeg', '3gp'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    return res.filePaths
  })

  /**
   * 本地视频 -> 音频：直接用 ffmpeg，不经 yt-dlp。
   * 用于"我本地已有视频，只要音频"的场景。
   */
  ipcMain.handle(
    'local:extract-audio',
    async (_e, payload: { files: string[]; format: string; bitrate: string; outDir?: string }) => {
      if (!existsSync(bin.ffmpeg)) throw new Error('未找到 ffmpeg.exe')
      const outDir = payload.outDir || settings.downloadDir
      await fsp.mkdir(outDir, { recursive: true })

      const results: { input: string; output: string; ok: boolean; error?: string }[] = []

      for (const file of payload.files) {
        const id = randomUUID()
        const name = basename(file, extname(file))
        const outPath = join(outDir, `${name}.${payload.format}`)

        // 先用 ffprobe 拿时长，用于把 -progress 的秒数换算成百分比
        const durationSec = await probeDuration(file)

        const job: Job = {
          id,
          kind: 'audio',
          url: file,
          title: name,
          status: 'downloading',
          percent: 0,
          downloaded: 0,
          total: 0,
          speed: '',
          eta: '',
          outputPath: outPath,
          log: [],
          target: `${payload.format.toUpperCase()} ${payload.bitrate}kbps`,
          durationSec,
          createdAt: Date.now()
        }
        jobs.set(id, job)
        emitJob({ ...job })

        const args = ['-y', '-i', file, '-vn']
        if (payload.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', `${payload.bitrate}k`)
        else if (payload.format === 'm4a') args.push('-c:a', 'aac', '-b:a', `${payload.bitrate}k`)
        else if (payload.format === 'opus') args.push('-c:a', 'libopus', '-b:a', `${payload.bitrate}k`)
        else if (payload.format === 'vorbis') args.push('-c:a', 'libvorbis', '-b:a', `${payload.bitrate}k`)
        else if (payload.format === 'flac') args.push('-c:a', 'flac')
        else if (payload.format === 'wav') args.push('-c:a', 'pcm_s16le')
        args.push(outPath)

        // 用 ffmpeg 的 -progress 输出解析进度
        const progressArgs = [...args.slice(0, 1), '-progress', 'pipe:1', '-nostats', ...args.slice(1)]

        const res = await new Promise<{ code: number; stderr: string }>((resolvePromise) => {
          const handle = spawnStream(bin.ffmpeg, progressArgs, {
            onLine: (line, stream) => {
              appendLog(id, line)
              // out_time_ms=12345678
              const m = /out_time_us=(\d+)/.exec(line)
              if (m && job.durationSec && job.durationSec > 0) {
                const secs = Number(m[1]) / 1_000_000
                updateJob(id, { percent: Math.min(99, (secs / job.durationSec) * 100) })
              }
            },
            onExit: (code) => resolvePromise({ code, stderr: job.log.join('\n') })
          })
          running.set(id, handle)
        })

        running.delete(id)

        if (res.code === 0) {
          updateJob(id, { status: 'done', percent: 100, finishedAt: Date.now() })
          results.push({ input: file, output: outPath, ok: true })
        } else {
          const err = humanizeError(res.stderr) || 'ffmpeg 转码失败'
          updateJob(id, { status: 'error', error: err, finishedAt: Date.now() })
          results.push({ input: file, output: outPath, ok: false, error: err })
        }
      }

      return results
    }
  )

  ipcMain.handle('shell:reveal', (_e, filePath: string) => {
    if (filePath && existsSync(filePath)) shell.showItemInFolder(filePath)
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('window:close', () => mainWindow?.close())

  ipcMain.handle('shell:open-download-dir', async () => {
    await fsp.mkdir(settings.downloadDir, { recursive: true })
    void shell.openPath(settings.downloadDir)
  })

  ipcMain.handle('shell:open-url', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  /**
   * 把已下载的音频交给 Aurora Player 播放。
   * Aurora Player 注册了音频文件关联，可以直接用 shell.openPath 交给系统默认程序；
   * 如果系统默认程序不是 Aurora Player，用户仍能正常播放（这是期望行为，不强行劫持）。
   */
  ipcMain.handle('shell:play-in-player', async (_e, filePath: string) => {
    if (!filePath || !existsSync(filePath)) return { ok: false, error: '文件不存在' }
    const err = await shell.openPath(filePath)
    return err ? { ok: false, error: err } : { ok: true }
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    binDir: bin.binDir
  }))
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    // 无边框：标题栏由渲染层自绘（否则会和系统原生标题栏同时出现两套最小化/最大化/关闭按钮）
    frame: false,
    backgroundColor: '#0f1116',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    autoHideMenuBar: true,
    title: 'Aurora Tools',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 自绘标题栏下，把窗口最大化状态同步给渲染层，便于切换图标
  const sendMaxState = (): void => {
    if (!mainWindow) return
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details: Electron.HandlerDetails) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.setAppUserModelId('com.aurora.tools')

  void app.whenReady().then(async () => {
    bin = resolveBinDir(app.getAppPath(), app.isPackaged)
    settingsPath = join(app.getPath('userData'), 'settings.json')
    await loadSettings()
    await fsp.mkdir(settings.downloadDir, { recursive: true }).catch(() => undefined)

    registerIpc()
    createWindow()

    // 窗口显示后再自检，避免拖慢启动观感
    setTimeout(() => void checkTools(), 300)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    for (const handle of running.values()) handle.kill()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
