import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, Job, MediaInfo, ToolInfo } from '../../shared/types'
import ProbePanel from './components/ProbePanel'
import QueuePanel from './components/QueuePanel'
import SettingsPanel from './components/SettingsPanel'
import TooltipLayer from './components/TooltipLayer'
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconFolder,
  IconInfo,
  IconLoading,
  IconMaximize,
  IconMinimize,
  IconRestore,
  IconSettings
} from './components/Icons'

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [toolInfo, setToolInfo] = useState<ToolInfo | null>(null)
  const [appInfo, setAppInfo] = useState<{ version: string; binDir: string; resourcesPath: string } | null>(null)

  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  const [jobs, setJobs] = useState<Job[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isMax, setIsMax] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const toastTimer = useRef<number>(0)

  /* ---------------- 拖放导入 ---------------- */
  const [dragging, setDragging] = useState(false)
  /** 拖入的媒体文件（token 让同一批文件可以重复拖入） */
  const [droppedFiles, setDroppedFiles] = useState<{ files: string[]; token: number }>({ files: [], token: 0 })
  /** 拖入的链接 */
  const [droppedUrl, setDroppedUrl] = useState<{ url: string; token: number }>({ url: '', token: 0 })
  const dragDepth = useRef(0)
  /** 用于取消正在进行的解析（yt-dlp 解析没有独立句柄，用世代号忽略过期结果） */
  const probeGen = useRef(0)

  const notify = useCallback((kind: 'ok' | 'err' | 'info', text: string): void => {
    setToast({ kind, text })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  /* ---------------- 拖放导入 ----------------
     注意：dataTransfer 在事件回调返回后会被浏览器置为失效，
     所以文件与文本必须在任何 await 之前同步取完。 */
  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)

      const dt = e.dataTransfer
      const files = Array.from(dt?.files ?? [])
      const uriText = dt?.getData('text/uri-list') || dt?.getData('text/plain') || ''
      const paths = files.map((f) => window.tools.pathForFile(f)).filter(Boolean)

      if (paths.length > 0) {
        const media = await window.tools.expandPaths(paths)
        if (media.length === 0) {
          notify('err', '拖入的内容里没有找到可提取的视频 / 音频文件')
          return
        }
        setDroppedFiles((prev) => ({ files: media, token: prev.token + 1 }))
        notify('ok', `已加入 ${media.length} 个文件，选好输出格式后点「提取音频」`)
        return
      }

      const firstUrl = uriText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => /^https?:\/\//i.test(s))

      if (firstUrl) {
        setDroppedUrl((prev) => ({ url: firstUrl, token: prev.token + 1 }))
        notify('info', '正在解析拖入的链接…')
        return
      }

      notify('err', '请拖入视频 / 音频文件、文件夹，或一个 http(s) 链接')
    },
    [notify]
  )

  /* ---------------- 启动 ---------------- */
  useEffect(() => {
    void (async () => {
      const [s, t, a, list] = await Promise.all([
        window.tools.getSettings(),
        window.tools.checkTools(),
        window.tools.appInfo(),
        window.tools.listJobs()
      ])
      setSettings(s)
      setToolInfo(t)
      setAppInfo(a)
      setJobs(list)

      if (!t.ytdlp) {
        notify('err', t.error ?? '内置 yt-dlp 不可用，下载功能无法使用')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 订阅任务事件 ---------------- */
  useEffect(() => {
    const offUpdate = window.tools.onJobUpdate((job) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id)
        if (idx < 0) return [...prev, job]
        const next = prev.slice()
        next[idx] = job
        return next
      })
    })
    const offDone = window.tools.onJobDone((job) => {
      notify('ok', `已完成：${job.title}`)
    })
    const offFailed = window.tools.onJobFailed((job) => {
      notify('err', `${job.title} — ${job.error ?? '下载失败'}`)
    })
    return () => {
      offUpdate()
      offDone()
      offFailed()
    }
  }, [notify])

  /* ---------------- 订阅最大化状态（自绘标题栏） ---------------- */
  useEffect(() => {
    const off = window.tools.onMaximizedChanged(setIsMax)
    void window.tools.isMaximized().then(setIsMax)
    return off
  }, [])

  /* ---------------- 解析 ---------------- */
  const handleProbe = useCallback(
    async (url: string): Promise<void> => {
      const gen = ++probeGen.current
      setProbing(true)
      setProbeError(null)
      setInfo(null)
      try {
        const result = await window.tools.probe(url)
        if (gen !== probeGen.current) return // 已被更新的解析取代
        setInfo(result)
        if (result.formats.length === 0 && !result.isLive) {
          notify('info', '未列出可选格式，可直接用"最佳画质"下载')
        }
      } catch (err) {
        if (gen !== probeGen.current) return
        const msg = (err as Error).message || '解析失败'
        // IPC 透传的错误常带前缀，剥掉让提示更干净
        setProbeError(msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''))
      } finally {
        if (gen === probeGen.current) setProbing(false)
      }
    },
    [notify]
  )

  const handleCancelProbe = useCallback((): void => {
    // 解析是短时任务，这里让结果作废即可
    probeGen.current++
    setProbing(false)
    notify('info', '已取消解析（后台进程会自动结束）')
  }, [notify])

  /* ---------------- 创建下载任务 ---------------- */
  const handleDownload = useCallback(
    async (kind: 'video' | 'audio', formatId: string, label: string): Promise<void> => {
      if (!info || !settings) return
      const id = await window.tools.createJob({
        url: info.url,
        kind,
        formatId,
        title: info.title,
        target: label,
        durationSec: info.duration
      })
      notify('ok', `已加入队列：${kind === 'audio' ? '音频' : '视频'} · ${label}`)
      return void id
    },
    [info, settings, notify]
  )

  /* ---------------- 任务操作 ---------------- */
  const changeSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.tools.setSettings(patch)
    setSettings(next)
  }, [])

  const pickDownloadDir = useCallback(async (): Promise<void> => {
    const dir = await window.tools.pickDownloadDir()
    if (dir && settings) setSettings({ ...settings, downloadDir: dir })
  }, [settings])

  const healthy = toolInfo?.ytdlp ?? false

  return (
    <div
      className={`app ${dragging ? 'is-dragover' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* ---------------- 标题栏 ---------------- */}
      <header className="titlebar">
        <div className="titlebar__brand drag">
          <span className="titlebar__mark" aria-hidden>
            <IconLoading width={14} height={14} />
          </span>
          <div className="titlebar__text">
            <span className="titlebar__title">Aurora Tools</span>
            <span className="titlebar__subtitle">
              视频解析下载 · 音频提取
              {toolInfo?.ytdlpVersion ? ` · yt-dlp ${toolInfo.ytdlpVersion}` : ''}
            </span>
          </div>
        </div>

        <div className="titlebar__spacer drag" />

        <div className="titlebar__actions no-drag">
          <span
            className={`statusdot ${healthy ? 'is-ok' : 'is-err'} tip`}
            data-tip={
              healthy
                ? `就绪：yt-dlp ${toolInfo?.ytdlpVersion ?? ''} + ffmpeg ${toolInfo?.ffmpegVersion ?? ''}`
                : (toolInfo?.error ?? '内置工具未就绪')
            }
          >
            {healthy ? <IconCheck width={12} height={12} /> : <IconAlert width={12} height={12} />}
          </span>
          <button
            type="button"
            className="icon-btn tip"
            data-tip="设置"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="设置"
          >
            <IconSettings width={15} height={15} />
          </button>
        </div>

        <div className="caption no-drag">
          <button
            type="button"
            className="caption-btn"
            data-tip="最小化"
            onClick={() => void window.tools.minimize()}
            aria-label="最小化"
          >
            <IconMinimize width={14} height={14} />
          </button>
          <button
            type="button"
            className="caption-btn"
            data-tip={isMax ? '向下还原' : '最大化'}
            onClick={() => void window.tools.toggleMaximize()}
            aria-label={isMax ? '向下还原' : '最大化'}
          >
            {isMax ? <IconRestore width={14} height={14} /> : <IconMaximize width={14} height={14} />}
          </button>
          <button
            type="button"
            className="caption-btn caption-btn--close"
            data-tip="关闭"
            onClick={() => void window.tools.closeWindow()}
            aria-label="关闭"
          >
            <IconClose width={14} height={14} />
          </button>
        </div>
      </header>

      {/* ---------------- 主体 ---------------- */}
      <main className="content">
        <div className="content__left">
          <ProbePanel
            info={info}
            loading={probing}
            error={probeError}
            settings={settings}
            onProbe={handleProbe}
            onDownload={handleDownload}
            onCancelProbe={handleCancelProbe}
            onChangeSettings={(patch) => void changeSettings(patch)}
            droppedFiles={droppedFiles}
            droppedUrl={droppedUrl}
          />
        </div>
        <div className="content__right">
          <QueuePanel
            jobs={jobs}
            onCancel={(id) => void window.tools.cancelJob(id)}
            onRetry={(id) => void window.tools.retryJob(id)}
            onRemove={(id) => void window.tools.removeJob(id)}
            onClearFinished={() => void window.tools.clearFinished().then(setJobs)}
            onReveal={(p) => void window.tools.reveal(p)}
            onPlay={(p) =>
              void window.tools.playInPlayer(p).then((r) => {
                if (!r.ok) notify('err', r.error ?? '无法打开文件')
              })
            }
            onOpenDir={() => void window.tools.openDownloadDir()}
          />
        </div>
      </main>

      {/* ---------------- 拖放遮罩 ---------------- */}
      {dragging && (
        <div className="dropzone" aria-hidden>
          <div className="dropzone__card card">
            <div className="dropzone__icon">
              <IconFolder width={32} height={32} />
            </div>
            <div className="dropzone__text">松开即可导入</div>
            <div className="dropzone__hint">
              视频 / 音频文件或整个文件夹会加入「本地提取」；http(s) 链接会直接解析
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 提示条 ---------------- */}
      {toast && (
        <div className={`toast toast--${toast.kind} card no-drag`}>
          {toast.kind === 'ok' && <IconCheck width={14} height={14} />}
          {toast.kind === 'err' && <IconAlert width={14} height={14} />}
          {toast.kind === 'info' && <IconInfo width={14} height={14} />}
          <span>{toast.text}</span>
        </div>
      )}

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        appInfo={appInfo}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => void changeSettings(patch)}
        onPickDownloadDir={() => void pickDownloadDir()}
      />

      {/* 全局悬停提示（portal 渲染，不会被任何容器裁切） */}
      <TooltipLayer />
    </div>
  )
}
