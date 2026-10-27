import electron from 'electron'
import type { AppSettings, Job, JobKind, MediaInfo, ToolInfo } from '../shared/types'

// electron-vite 下必须用 default 导入再解构，否则 CJS 里拿到 undefined
const { contextBridge, ipcRenderer, webUtils } = electron

export interface LocalExtractResult {
  input: string
  output: string
  ok: boolean
  error?: string
}

export interface AuroraToolsApi {
  checkTools: () => Promise<ToolInfo>
  probe: (url: string) => Promise<MediaInfo>

  createJob: (payload: {
    url: string
    kind: JobKind
    formatId?: string
    title: string
    target: string
    durationSec?: number
  }) => Promise<string>
  listJobs: () => Promise<Job[]>
  cancelJob: (id: string) => Promise<boolean>
  retryJob: (id: string) => Promise<boolean>
  removeJob: (id: string) => Promise<boolean>
  clearFinished: () => Promise<Job[]>

  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>

  pickDownloadDir: () => Promise<string | null>
  pickVideoFiles: () => Promise<string[]>

  /** 从拖拽的 File 对象取绝对路径（Electron 32+ 必须走 webUtils，File.path 已废弃） */
  pathForFile: (file: File) => string
  /** 把拖入的文件/文件夹展开成媒体文件列表（目录会递归） */
  expandPaths: (paths: string[]) => Promise<string[]>

  extractLocalAudio: (payload: {
    files: string[]
    format: string
    bitrate: string
    outDir?: string
  }) => Promise<LocalExtractResult[]>

  reveal: (filePath: string) => Promise<void>
  openDownloadDir: () => Promise<void>
  openUrl: (url: string) => Promise<void>
  playInPlayer: (filePath: string) => Promise<{ ok: boolean; error?: string }>

  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  closeWindow: () => Promise<void>
  appInfo: () => Promise<{
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    resourcesPath: string
    binDir: string
  }>

  onJobUpdate: (cb: (job: Job) => void) => () => void
  onJobDone: (cb: (job: Job) => void) => () => void
  onJobFailed: (cb: (job: Job) => void) => () => void
  /** 窗口最大化状态变化（自绘标题栏据此切换图标） */
  onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void
}

const api: AuroraToolsApi = {
  checkTools: () => ipcRenderer.invoke('tools:check'),
  probe: (url) => ipcRenderer.invoke('media:probe', url),

  createJob: (payload) => ipcRenderer.invoke('jobs:create', payload),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  retryJob: (id) => ipcRenderer.invoke('jobs:retry', id),
  removeJob: (id) => ipcRenderer.invoke('jobs:remove', id),
  clearFinished: () => ipcRenderer.invoke('jobs:clear-finished'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  pickDownloadDir: () => ipcRenderer.invoke('dialog:pick-download-dir'),
  pickVideoFiles: () => ipcRenderer.invoke('dialog:pick-video-file'),

  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  expandPaths: (paths) => ipcRenderer.invoke('tools:expand-paths', paths),

  extractLocalAudio: (payload) => ipcRenderer.invoke('local:extract-audio', payload),

  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  openDownloadDir: () => ipcRenderer.invoke('shell:open-download-dir'),
  openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  playInPlayer: (filePath) => ipcRenderer.invoke('shell:play-in-player', filePath),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  onJobUpdate: (cb) => {
    const listener = (_e: unknown, job: Job): void => cb(job)
    ipcRenderer.on('job:update', listener)
    return () => ipcRenderer.removeListener('job:update', listener)
  },
  onJobDone: (cb) => {
    const listener = (_e: unknown, job: Job): void => cb(job)
    ipcRenderer.on('job:done', listener)
    return () => ipcRenderer.removeListener('job:done', listener)
  },
  onJobFailed: (cb) => {
    const listener = (_e: unknown, job: Job): void => cb(job)
    ipcRenderer.on('job:failed', listener)
    return () => ipcRenderer.removeListener('job:failed', listener)
  },
  onMaximizedChanged: (cb) => {
    const listener = (_e: unknown, max: boolean): void => cb(max)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  }
}

contextBridge.exposeInMainWorld('tools', api)
