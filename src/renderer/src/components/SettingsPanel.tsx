import { useEffect, useState } from 'react'
import { AUDIO_FORMAT_LABEL, type AppSettings, type AudioFormat, type VideoContainer } from '../../../shared/types'
import Dropdown from './Dropdown'
import { IconCheck, IconClose, IconFolder } from './Icons'

interface Props {
  open: boolean
  settings: AppSettings | null
  appInfo: { version: string; binDir: string; resourcesPath: string } | null
  onClose: () => void
  onChange: (patch: Partial<AppSettings>) => void
  onPickDownloadDir: () => void
}

export default function SettingsPanel({
  open,
  settings,
  appInfo,
  onClose,
  onChange,
  onPickDownloadDir
}: Props): React.JSX.Element | null {
  const [rateLimit, setRateLimit] = useState(settings?.rateLimit ?? '')

  useEffect(() => {
    if (settings) setRateLimit(settings.rateLimit)
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !settings) return null

  return (
    <div className="settings-overlay no-drag" onMouseDown={onClose}>
      <aside className="settings card" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <header className="settings__head">
          <h2>设置</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭设置">
            <IconClose width={14} height={14} />
          </button>
        </header>

        <div className="settings__body">
          <div className="settings__section">保存位置</div>
          <div className="settings__field">
            <div className="settings__dir">
              <code className="settings__path" title={settings.downloadDir}>
                {settings.downloadDir}
              </code>
              <button type="button" className="btn btn--sm" onClick={onPickDownloadDir}>
                <IconFolder width={14} height={14} />
                更改
              </button>
            </div>
          </div>

          <div className="settings__section">音频提取</div>
          <div className="settings__field settings__field--row">
            <label htmlFor="afmt">默认输出格式</label>
            <Dropdown
              className="dd--settings"
              ariaLabel="默认输出格式"
              value={settings.audioFormat}
              options={(Object.keys(AUDIO_FORMAT_LABEL) as AudioFormat[]).map((k) => ({
                value: k,
                label: AUDIO_FORMAT_LABEL[k]
              }))}
              onChange={(v) => onChange({ audioFormat: v as AudioFormat })}
            />
          </div>

          <div className="settings__section">视频</div>
          <div className="settings__field settings__field--row">
            <label htmlFor="vcont">输出容器</label>
            <Dropdown
              className="dd--settings"
              ariaLabel="输出容器"
              value={settings.videoContainer}
              options={[
                { value: 'mp4', label: 'MP4', hint: '兼容性最好' },
                { value: 'mkv', label: 'MKV', hint: '保留多音轨/字幕' },
                { value: 'webm', label: 'WebM' },
                { value: 'auto', label: '不指定', hint: '跟随源' }
              ]}
              onChange={(v) => onChange({ videoContainer: v as VideoContainer })}
            />
          </div>

          <div className="settings__field settings__field--row">
            <label htmlFor="embed-thumb">嵌入缩略图 / 封面</label>
            <input
              id="embed-thumb"
              className="toggle"
              type="checkbox"
              checked={settings.embedThumbnail}
              onChange={(e) => onChange({ embedThumbnail: e.target.checked })}
            />
          </div>

          <div className="settings__field settings__field--row">
            <label htmlFor="embed-meta">嵌入元数据（标题/作者）</label>
            <input
              id="embed-meta"
              className="toggle"
              type="checkbox"
              checked={settings.embedMetadata}
              onChange={(e) => onChange({ embedMetadata: e.target.checked })}
            />
          </div>

          <div className="settings__field settings__field--row">
            <label htmlFor="subs">同时下载字幕（若有）</label>
            <input
              id="subs"
              className="toggle"
              type="checkbox"
              checked={settings.writeSubs}
              onChange={(e) => onChange({ writeSubs: e.target.checked })}
            />
          </div>

          <div className="settings__section">网络与性能</div>
          <div className="settings__field settings__field--row">
            <label htmlFor="noplaylist">只下载单个视频（忽略播放列表）</label>
            <input
              id="noplaylist"
              className="toggle"
              type="checkbox"
              checked={settings.noPlaylist}
              onChange={(e) => onChange({ noPlaylist: e.target.checked })}
            />
          </div>

          <div className="settings__field">
            <label htmlFor="conc">
              同时下载任务数 <span className="settings__val">{settings.concurrency}</span>
            </label>
            <input
              id="conc"
              className="slider"
              type="range"
              min={1}
              max={5}
              step={1}
              value={settings.concurrency}
              style={{ ['--pct' as string]: `${((settings.concurrency - 1) / 4) * 100}%` }}
              onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
            />
          </div>

          <div className="settings__field">
            <label htmlFor="retries">
              失败重试次数 <span className="settings__val">{settings.retries}</span>
            </label>
            <input
              id="retries"
              className="slider"
              type="range"
              min={0}
              max={20}
              step={1}
              value={settings.retries}
              style={{ ['--pct' as string]: `${(settings.retries / 20) * 100}%` }}
              onChange={(e) => onChange({ retries: Number(e.target.value) })}
            />
          </div>

          <div className="settings__field">
            <label htmlFor="rate">下载限速（留空 = 不限速）</label>
            <input
              id="rate"
              className="input"
              placeholder="例如 2M 表示最高 2MB/s"
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              onBlur={() => onChange({ rateLimit: rateLimit.trim() })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onChange({ rateLimit: rateLimit.trim() })
              }}
            />
          </div>

          <div className="settings__field settings__field--row">
            <label htmlFor="useproxy">使用代理</label>
            <input
              id="useproxy"
              className="toggle"
              type="checkbox"
              checked={settings.useProxy}
              onChange={(e) => onChange({ useProxy: e.target.checked })}
            />
          </div>

          {settings.useProxy && (
            <div className="settings__field">
              <label htmlFor="proxy">代理地址</label>
              <input
                id="proxy"
                className="input"
                placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                value={settings.proxyUrl}
                onChange={(e) => onChange({ proxyUrl: e.target.value })}
              />
            </div>
          )}

          <div className="settings__section">关于</div>
          <div className="settings__about">
            <div className="settings__about-row">
              <span>版本</span>
              <span>{appInfo?.version ?? '—'}</span>
            </div>
            <div className="settings__about-row">
              <span>内置工具目录</span>
              <span className="settings__path-inline" title={appInfo?.binDir}>
                {appInfo?.binDir ?? '—'}
              </span>
            </div>
            <div className="settings__about-row">
              <span>状态</span>
              <span className="is-ok">
                <IconCheck width={13} height={13} />
                离线可用（已内置 yt-dlp + ffmpeg）
              </span>
            </div>
          </div>

          <div className="settings__notice">
            本工具仅可用于你拥有版权、已获授权或法律允许下载的内容。
            请遵守目标站点的服务条款与当地法律，不要用于绕过付费、会员或 DRM 保护。
          </div>
        </div>
      </aside>
    </div>
  )
}
