import { useEffect, useMemo, useState } from 'react'
import {
  AUDIO_BITRATES,
  AUDIO_FORMAT_LABEL,
  type AppSettings,
  type AudioFormat,
  type FormatInfo,
  type MediaInfo
} from '../../../shared/types'
import { formatBytes, formatDuration } from '../utils/format'
import Dropdown from './Dropdown'
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconDownload,
  IconExternal,
  IconFolder,
  IconInfo,
  IconLoading,
  IconMusic,
  IconScissors,
  IconSearch,
  IconVideo
} from './Icons'

interface Props {
  info: MediaInfo | null
  loading: boolean
  error: string | null
  settings: AppSettings | null
  onProbe: (url: string) => void
  onDownload: (kind: 'video' | 'audio', formatId: string, label: string) => void
  onCancelProbe: () => void
  /** 修改设置：必须回写 App 的 state，否则受控组件会立刻被重置为旧值 */
  onChangeSettings: (patch: Partial<AppSettings>) => void
  /** 拖入的媒体文件（token 变化时才处理，允许重复拖入同一批） */
  droppedFiles: { files: string[]; token: number }
  /** 拖入的链接 */
  droppedUrl: { url: string; token: number }
}

type Tab = 'video' | 'audio'

/** 音频格式下拉选项（多处复用） */
const AUDIO_FORMAT_OPTIONS = (Object.keys(AUDIO_FORMAT_LABEL) as AudioFormat[]).map((k) => ({
  value: k,
  label: AUDIO_FORMAT_LABEL[k]
}))

export default function ProbePanel({
  info,
  loading,
  error,
  settings,
  onProbe,
  onDownload,
  onCancelProbe,
  onChangeSettings,
  droppedFiles,
  droppedUrl
}: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [tab, setTab] = useState<Tab>('video')
  const [showAllFormats, setShowAllFormats] = useState(false)

  useEffect(() => {
    if (info) setTab('video')
  }, [info])

  /* 拖入链接：填进输入框并立即解析 */
  useEffect(() => {
    if (!droppedUrl.url || droppedUrl.token === 0) return
    setUrl(droppedUrl.url)
    onProbe(droppedUrl.url)
    // 只在 token 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedUrl.token])

  const videoFormats = useMemo(() => {
    if (!info) return []
    // 优先展示"含音轨"的成品格式（下载后即可用），纯视频放后面
    const merged = info.formats.filter((f) => !f.audioOnly && !f.videoOnly)
    const videoOnly = info.formats.filter((f) => f.videoOnly)
    const list = [...merged, ...videoOnly]
    if (showAllFormats) return list
    // 精简视图：按清晰度分组，每档保留一个
    const byHeight = new Map<number, FormatInfo>()
    for (const f of list) {
      const h = f.height ?? 0
      const existing = byHeight.get(h)
      // 优先保留带音轨的、体积信息完整的
      if (!existing) byHeight.set(h, f)
      else if (existing.videoOnly && !f.videoOnly) byHeight.set(h, f)
      else if (existing.videoOnly === f.videoOnly && (f.filesize ?? 0) > (existing.filesize ?? 0)) byHeight.set(h, f)
    }
    return Array.from(byHeight.values()).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
  }, [info, showAllFormats])

  const audioFormats = useMemo(() => {
    if (!info) return []
    return info.formats.filter((f) => f.audioOnly)
  }, [info])

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (url.trim()) onProbe(url.trim())
  }

  const isLive = info?.isLive

  return (
    <section className="probe card">
      {/* ---------- URL 输入 ---------- */}
      <form className="probe__input-row no-drag" onSubmit={submit}>
        <IconSearch width={15} height={15} className="probe__search-icon" />
        <input
          className="input probe__input"
          placeholder="粘贴视频页面链接（B站 / YouTube / Twitter 等 yt-dlp 支持的站点）后回车"
          value={url}
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        {loading ? (
          <button type="button" className="btn" onClick={onCancelProbe}>
            <IconLoading width={14} height={14} className="spin" />
            取消
          </button>
        ) : (
          <button type="submit" className="btn btn--accent" disabled={!url.trim()}>
            解析
          </button>
        )}
      </form>

      {error && (
        <div className="probe__error">
          <IconAlert width={15} height={15} />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="probe__loading">
          <IconLoading width={16} height={16} className="spin" />
          <span>正在解析媒体信息，站点响应较慢时可能需要十几秒…</span>
        </div>
      )}

      {/* ---------- 解析结果 ---------- */}
      {info && !loading && (
        <>
          <div className="mediainfo">
            {info.thumbnail && (
              <div className="mediainfo__thumb">
                <img src={info.thumbnail} alt="" loading="lazy" />
                {info.duration ? <span className="mediainfo__dur">{formatDuration(info.duration)}</span> : null}
                {isLive && <span className="mediainfo__live">直播</span>}
              </div>
            )}
            <div className="mediainfo__text">
              <h2 className="mediainfo__title" title={info.title}>
                {info.title}
              </h2>
              <div className="mediainfo__meta">
                {info.uploader && <span>{info.uploader}</span>}
                {info.extractor && <span className="tag">{info.extractor}</span>}
                {info.uploadDate && <span>{formatDate(info.uploadDate)}</span>}
                {info.viewCount ? <span>{formatCount(info.viewCount)} 次播放</span> : null}
              </div>
              <button
                type="button"
                className="btn btn--subtle btn--sm"
                onClick={() => void window.tools.openUrl(info.url)}
              >
                <IconExternal width={13} height={13} />
                在浏览器打开原页面
              </button>
            </div>
          </div>

          <div className="probe__tabs">
            <div className="segment" role="tablist">
              <button
                type="button"
                className="segment__item"
                aria-pressed={tab === 'video'}
                onClick={() => setTab('video')}
                role="tab"
              >
                <IconVideo width={14} height={14} />
                视频 ({videoFormats.length})
              </button>
              <button
                type="button"
                className="segment__item"
                aria-pressed={tab === 'audio'}
                onClick={() => setTab('audio')}
                role="tab"
              >
                <IconMusic width={14} height={14} />
                仅音频
              </button>
            </div>
          </div>

          {/* ---------- 视频格式 ---------- */}
          {tab === 'video' && (
            <>
              <div className="probe__section-head">
                <span className="probe__hint">
                  选择清晰度后点击下载；标「无音轨」的条目会自动合并最佳音轨
                </span>
                <button type="button" className="btn btn--subtle btn--sm" onClick={() => setShowAllFormats((v) => !v)}>
                  {showAllFormats ? '精简视图' : '显示全部格式'}
                </button>
              </div>
              <div className="formatlist">
                <button
                  type="button"
                  className="format format--best"
                  onClick={() =>
                    onDownload(
                      'video',
                      '',
                      `最佳画质 · ${settings?.videoContainer === 'auto' ? '自动容器' : settings?.videoContainer?.toUpperCase()}`
                    )
                  }
                >
                  <span className="format__main">
                    <span className="format__label">最佳画质（自动选择）</span>
                    <span className="format__note">按站点提供的最优视频 + 最优音轨合并</span>
                  </span>
                  <IconDownload width={15} height={15} />
                </button>

                {videoFormats.map((f) => (
                  <button
                    key={f.formatId}
                    type="button"
                    className="format"
                    onClick={() => onDownload('video', f.formatId, f.label)}
                  >
                    <span className="format__main">
                      <span className="format__label">{f.label}</span>
                      <span className="format__note">
                        {[
                          f.videoOnly ? '无音轨，自动合并' : '含音轨',
                          f.filesize ? formatBytes(f.filesize) : '体积未知',
                          f.fps && f.fps > 30 ? `${Math.round(f.fps)}fps` : ''
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <IconDownload width={15} height={15} />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ---------- 仅音频 ---------- */}
          {tab === 'audio' && (
            <>
              <div className="audiopick card">
                <div className="audiopick__row">
                  <div className="audiopick__item">
                    <label>输出格式</label>
                    <div className="audiopick__hint">转换后可用于 Aurora Player 播放</div>
                  </div>
                  <Dropdown
                    className="dd--settings"
                    ariaLabel="输出格式"
                    value={settings?.audioFormat ?? 'mp3'}
                    options={AUDIO_FORMAT_OPTIONS}
                    onChange={(v) => onChangeSettings({ audioFormat: v as AudioFormat })}
                  />
                </div>

                {(AUDIO_BITRATES[settings?.audioFormat ?? 'mp3'] ?? []).length > 0 && (
                  <div className="audiopick__row">
                    <div className="audiopick__item">
                      <label>比特率</label>
                      <div className="audiopick__hint">越高音质越好、文件越大</div>
                    </div>
                    <div className="segment">
                      {AUDIO_BITRATES[settings?.audioFormat ?? 'mp3'].map((b) => (
                        <button
                          key={b}
                          type="button"
                          className="segment__item"
                          aria-pressed={(settings?.audioBitrate ?? '192') === b}
                          onClick={() => onChangeSettings({ audioBitrate: b })}
                        >
                          {b}k
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="audiopick__actions">
                  <button
                    type="button"
                    className="btn btn--accent"
                    onClick={() =>
                      onDownload(
                        'audio',
                        '',
                        `${AUDIO_FORMAT_LABEL[settings?.audioFormat ?? 'mp3']}` +
                          ((AUDIO_BITRATES[settings?.audioFormat ?? 'mp3'] ?? []).length
                            ? ` ${settings?.audioBitrate}k`
                            : '')
                      )
                    }
                  >
                    <IconMusic width={15} height={15} />
                    提取最佳音轨并转换
                  </button>
                  <span className="audiopick__note">
                    <IconInfo width={13} height={13} />
                    无损格式（FLAC/WAV）会忽略比特率设置
                  </span>
                </div>
              </div>

              {audioFormats.length > 0 && (
                <>
                  <div className="probe__section-head">
                    <span className="probe__hint">或直接选择站点提供的原始音轨（不转码，速度更快）</span>
                  </div>
                  <div className="formatlist">
                    {audioFormats.map((f) => (
                      <button
                        key={f.formatId}
                        type="button"
                        className="format"
                        onClick={() => onDownload('audio', f.formatId, f.label)}
                      >
                        <span className="format__main">
                          <span className="format__label">{f.label}</span>
                          <span className="format__note">
                            {[f.filesize ? formatBytes(f.filesize) : '体积未知', '保持原始编码']
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <IconDownload width={15} height={15} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {!info && !loading && !error && (
        <div className="probe__empty">
          <IconInfo width={16} height={16} />
          <div>
            <p className="probe__empty-title">贴一个视频链接开始，或直接把文件拖进窗口</p>
            <p className="probe__empty-hint">
              链接支持 yt-dlp 能解析的站点；拖入视频 / 音频文件或文件夹会进入下方的「本地提取」。
              工具已内置 yt-dlp 与 ffmpeg，无需额外安装。
              <br />
              仅可用于你拥有权利或已获授权的内容。
            </p>
          </div>
        </div>
      )}

      {/* ---------- 本地提取：常驻显示，无需先解析链接 ---------- */}
      <div className="probe__divider">
        <span>本地视频提取音频</span>
      </div>
      <LocalExtract settings={settings} onChangeSettings={onChangeSettings} droppedFiles={droppedFiles} />
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 本地视频 -> 音频
 * ------------------------------------------------------------------ */
function LocalExtract({
  settings,
  onChangeSettings,
  droppedFiles
}: {
  settings: AppSettings | null
  onChangeSettings: (patch: Partial<AppSettings>) => void
  droppedFiles: { files: string[]; token: number }
}): React.JSX.Element {
  const [files, setFiles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ input: string; output: string; ok: boolean; error?: string }[]>([])

  /* 拖入的文件直接并入待提取列表（去重，但同一批可重复拖入） */
  useEffect(() => {
    if (droppedFiles.token === 0 || droppedFiles.files.length === 0) return
    setFiles((prev) => Array.from(new Set([...prev, ...droppedFiles.files])))
  }, [droppedFiles.token, droppedFiles.files])

  const pick = async (): Promise<void> => {
    const picked = await window.tools.pickVideoFiles()
    if (picked.length) setFiles((prev) => Array.from(new Set([...prev, ...picked])))
  }

  const run = async (): Promise<void> => {
    if (files.length === 0 || !settings) return
    setBusy(true)
    setResults([])
    try {
      const fmt = settings.audioFormat
      const res = await window.tools.extractLocalAudio({
        files,
        format: fmt,
        bitrate: settings.audioBitrate
      })
      setResults(res)
      if (res.every((r) => r.ok)) setFiles([])
    } finally {
      setBusy(false)
    }
  }

  const bitrates = AUDIO_BITRATES[settings?.audioFormat ?? 'mp3'] ?? []

  return (
    <div className="local">
      <div className="local__head">
        <span className="probe__hint">
          手上有视频文件？直接拖进窗口，或点右侧选择文件 —— 走 ffmpeg 不经过网络，也不依赖 yt-dlp
        </span>
        <button type="button" className="btn btn--sm" onClick={() => void pick()} disabled={busy}>
          <IconFolder width={14} height={14} />
          选择视频文件
        </button>
      </div>

      {/* 本地提取也必须能改输出格式，否则用户还得去设置面板绕一圈 */}
      <div className="local__opts">
        <span className="local__opt-label">输出</span>
        <Dropdown
          className="dd--sm"
          ariaLabel="本地提取输出格式"
          value={settings?.audioFormat ?? 'mp3'}
          options={AUDIO_FORMAT_OPTIONS}
          onChange={(v) => onChangeSettings({ audioFormat: v as AudioFormat })}
        />
        {bitrates.length > 0 && (
          <>
            <span className="local__opt-label">比特率</span>
            <div className="segment segment--sm">
              {bitrates.map((b) => (
                <button
                  key={b}
                  type="button"
                  className="segment__item"
                  aria-pressed={(settings?.audioBitrate ?? '192') === b}
                  onClick={() => onChangeSettings({ audioBitrate: b })}
                >
                  {b}k
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {files.length > 0 && (
        <>
          <ul className="local__list">
            {files.map((f) => (
              <li key={f} className="local__item">
                <IconVideo width={14} height={14} />
                <span className="local__name" title={f}>
                  {f.split(/[\\/]/).pop()}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                  aria-label="移除"
                  disabled={busy}
                >
                  <IconClose width={12} height={12} />
                </button>
              </li>
            ))}
          </ul>

          <div className="local__actions">
            <button type="button" className="btn btn--accent" onClick={() => void run()} disabled={busy}>
              {busy ? <IconLoading width={14} height={14} className="spin" /> : <IconScissors width={14} height={14} />}
              提取音频（{files.length} 个文件）
            </button>
            <span className="audiopick__note">
              输出 {AUDIO_FORMAT_LABEL[settings?.audioFormat ?? 'mp3']} 到 {settings?.downloadDir}
            </span>
          </div>
        </>
      )}

      {results.length > 0 && (
        <ul className="local__results">
          {results.map((r) => (
            <li key={r.output} className={`local__result ${r.ok ? 'is-ok' : 'is-err'}`}>
              {r.ok ? <IconCheck width={14} height={14} /> : <IconAlert width={14} height={14} />}
              <span className="local__name" title={r.output}>
                {r.output.split(/[\\/]/).pop()}
              </span>
              {r.ok ? (
                <button type="button" className="btn btn--subtle btn--sm" onClick={() => void window.tools.reveal(r.output)}>
                  打开位置
                </button>
              ) : (
                <span className="local__err">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 && results.length === 0 && (
        <div className="probe__empty">
          <IconVideo width={16} height={16} />
          <div>
            <p className="probe__empty-title">选择本地视频文件</p>
            <p className="probe__empty-hint">支持 mp4 / mkv / webm / avi / mov / flv / wmv 等格式</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */
function formatDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

function formatCount(n: number): string {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '亿'
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '万'
  return String(n)
}
