/** 主进程 / 预加载 / 渲染层共享类型 */

export type JobKind = 'video' | 'audio'
export type JobStatus = 'queued' | 'probing' | 'downloading' | 'converting' | 'done' | 'error' | 'canceled'

export interface FormatInfo {
  /** yt-dlp 的 format_id，用于 -f 参数 */
  formatId: string
  /** 展示标签，如 "1080p mp4 (avc1)" */
  label: string
  ext: string
  /** 视频高度，音频为 undefined */
  height?: number
  fps?: number
  /** 码率，音频用 */
  abr?: number
  /** 视频码率 */
  vbr?: number
  /** 文件大小（字节），未知则 undefined */
  filesize?: number
  /** 是否纯音频 */
  audioOnly: boolean
  /** 是否纯视频（无音轨，需合并） */
  videoOnly: boolean
  /** 编码器 */
  vcodec?: string
  acodec?: string
  /** 备注，如 "需合并音轨" */
  note?: string
}

export interface MediaInfo {
  /** 用于重新请求的原始 URL */
  url: string
  id: string
  title: string
  uploader?: string
  /** 时长（秒） */
  duration?: number
  /** 缩略图 URL */
  thumbnail?: string
  /** 站点名 */
  extractor?: string
  description?: string
  /** 上传日期 YYYYMMDD */
  uploadDate?: string
  /** 播放量 */
  viewCount?: number
  formats: FormatInfo[]
  /** 是否直播 */
  isLive?: boolean
}

export interface Job {
  id: string
  kind: JobKind
  url: string
  title: string
  status: JobStatus
  /** 0-100 */
  percent: number
  /** 已下载字节 */
  downloaded: number
  /** 总字节，未知则 0 */
  total: number
  /** 速度文本，如 "3.2MiB/s" */
  speed: string
  /** 剩余时间文本 ETA */
  eta: string
  /** 输出文件绝对路径 */
  outputPath?: string
  error?: string
  /** 最近若干行日志 */
  log: string[]
  /** 目标格式描述 */
  target: string
  /** 用于 -f 参数的 format_id */
  targetFormatId?: string
  /** 媒体时长（秒），本地转码时用于估算进度 */
  durationSec?: number
  createdAt: number
  finishedAt?: number
}

export interface ToolInfo {
  /** yt-dlp 是否可用 */
  ytdlp: boolean
  ytdlpVersion?: string
  /** ffmpeg 是否可用 */
  ffmpeg: boolean
  ffmpegVersion?: string
  /** 二进制目录 */
  binDir: string
  error?: string
}

export interface AppSettings {
  /** 下载保存目录 */
  downloadDir: string
  /** 音频提取格式 */
  audioFormat: AudioFormat
  /** 音频比特率 (kbps) */
  audioBitrate: string
  /** 视频容器 */
  videoContainer: VideoContainer
  /** 并发下载数 */
  concurrency: number
  /** 下载字幕 */
  writeSubs: boolean
  /** 嵌入缩略图 */
  embedThumbnail: boolean
  /** 嵌入元数据 */
  embedMetadata: boolean
  /** 无播放列表：只下单个视频 */
  noPlaylist: boolean
  /** 使用系统代理（读环境变量） */
  useProxy: boolean
  proxyUrl: string
  /** 限速，如 "2M" 表示 2MB/s，空表示不限 */
  rateLimit: string
  /** 重试次数 */
  retries: number
}

export type AudioFormat = 'mp3' | 'm4a' | 'flac' | 'wav' | 'opus' | 'vorbis'
export type VideoContainer = 'mp4' | 'mkv' | 'webm' | 'auto'

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  audioFormat: 'mp3',
  audioBitrate: '192',
  videoContainer: 'mp4',
  concurrency: 2,
  writeSubs: false,
  embedThumbnail: true,
  embedMetadata: true,
  noPlaylist: true,
  useProxy: false,
  proxyUrl: '',
  rateLimit: '',
  retries: 5
}

/** 音频格式的可选比特率 */
export const AUDIO_BITRATES: Record<AudioFormat, string[]> = {
  mp3: ['128', '192', '256', '320'],
  m4a: ['128', '192', '256'],
  flac: [], // 无损，无比特率概念
  wav: [],
  opus: ['96', '128', '160', '192'],
  vorbis: ['128', '192', '256']
}

export const AUDIO_FORMAT_LABEL: Record<AudioFormat, string> = {
  mp3: 'MP3',
  m4a: 'M4A (AAC)',
  flac: 'FLAC (无损)',
  wav: 'WAV (无损)',
  opus: 'Opus',
  vorbis: 'OGG Vorbis'
}
