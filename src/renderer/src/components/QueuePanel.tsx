import { useState } from 'react'
import type { Job } from '../../../shared/types'
import { formatBytes, shortPath } from '../utils/format'
import {
  IconAlert,
  IconCheck,
  IconChevron,
  IconFolder,
  IconMusic,
  IconPlay,
  IconRefresh,
  IconStop,
  IconTrash,
  IconVideo
} from './Icons'

interface Props {
  jobs: Job[]
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onClearFinished: () => void
  onReveal: (path: string) => void
  onPlay: (path: string) => void
  onOpenDir: () => void
}

export default function QueuePanel({
  jobs,
  onCancel,
  onRetry,
  onRemove,
  onClearFinished,
  onReveal,
  onPlay,
  onOpenDir
}: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting')
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error' || j.status === 'canceled')

  return (
    <section className="queue card">
      <div className="queue__head">
        <div className="queue__title">
          <span>任务队列</span>
          {active.length > 0 && <span className="badge">{active.length} 进行中</span>}
          {finished.length > 0 && <span className="queue__sub">{finished.length} 已完成</span>}
        </div>
        <div className="queue__tools">
          <button type="button" className="btn btn--subtle btn--sm" onClick={onOpenDir}>
            <IconFolder width={14} height={14} />
            下载目录
          </button>
          {finished.length > 0 && (
            <button type="button" className="btn btn--subtle btn--sm" onClick={onClearFinished}>
              清除已完成
            </button>
          )}
        </div>
      </div>

      <div className="queue__list">
        {jobs.length === 0 && (
          <div className="queue__empty">
            <p>暂无任务</p>
            <p className="queue__empty-hint">解析链接后选择清晰度或"仅音频"即可加入队列</p>
          </div>
        )}

        {[...active, ...finished].map((job) => {
          const isActive = job.status === 'queued' || job.status === 'downloading' || job.status === 'converting'
          const isOpen = expanded === job.id

          return (
            <div key={job.id} className={`job job--${job.status}`}>
              <div className="job__row">
                <span className={`job__icon job__icon--${job.kind}`}>
                  {job.kind === 'audio' ? <IconMusic width={14} height={14} /> : <IconVideo width={14} height={14} />}
                </span>

                <div className="job__main">
                  <div className="job__title" title={job.title}>
                    {job.title}
                  </div>
                  <div className="job__meta">
                    <span className={`job__status job__status--${job.status}`}>{statusLabel(job.status)}</span>
                    <span className="job__target">{job.target}</span>
                    {job.speed && isActive && <span>{job.speed}</span>}
                    {job.eta && isActive && <span>剩余 {job.eta}</span>}
                    {job.total > 0 && isActive && (
                      <span>
                        {formatBytes(job.downloaded)} / {formatBytes(job.total)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="job__actions">
                  {isActive && (
                    <>
                      <span className="job__pct">{Math.round(job.percent)}%</span>
                      <button
                        type="button"
                        className="icon-btn tip"
                        data-tip="取消"
                        onClick={() => onCancel(job.id)}
                        aria-label="取消"
                      >
                        <IconStop width={13} height={13} />
                      </button>
                    </>
                  )}

                  {job.status === 'done' && (
                    <>
                      <IconCheck width={15} height={15} className="job__done-icon" />
                      {job.outputPath && (
                        <>
                          <button
                            type="button"
                            className="btn btn--subtle btn--sm tip"
                            data-tip="用系统默认播放器打开（例如 Aurora Player）"
                            onClick={() => onPlay(job.outputPath!)}
                          >
                            <IconPlay width={13} height={13} />
                            播放
                          </button>
                          <button
                            type="button"
                            className="btn btn--subtle btn--sm"
                            onClick={() => onReveal(job.outputPath!)}
                          >
                            <IconFolder width={13} height={13} />
                            打开位置
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {job.status === 'error' && (
                    <>
                      <IconAlert width={15} height={15} className="job__err-icon" />
                      <button
                        type="button"
                        className="icon-btn tip"
                        data-tip="重试"
                        onClick={() => onRetry(job.id)}
                        aria-label="重试"
                      >
                        <IconRefresh width={14} height={14} />
                      </button>
                    </>
                  )}

                  {(job.status === 'canceled' || job.status === 'error') && (
                    <button
                      type="button"
                      className="icon-btn tip"
                      data-tip="移除"
                      onClick={() => onRemove(job.id)}
                      aria-label="移除"
                    >
                      <IconTrash width={13} height={13} />
                    </button>
                  )}

                  {job.log.length > 0 && (
                    <button
                      type="button"
                      className={`icon-btn tip ${isOpen ? 'is-open' : ''}`}
                      data-tip={isOpen ? '收起日志' : '查看日志'}
                      onClick={() => setExpanded(isOpen ? null : job.id)}
                      aria-label="日志"
                      aria-expanded={isOpen}
                    >
                      <IconChevron
                        width={14}
                        height={14}
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}
                      />
                    </button>
                  )}
                </div>
              </div>

              {isActive && (
                <div className="job__bar">
                  <div
                    className={`job__bar-fill ${job.status === 'converting' ? 'is-indeterminate' : ''}`}
                    style={{ width: `${job.percent}%` }}
                  />
                </div>
              )}

              {job.status === 'error' && job.error && (
                <div className="job__error">
                  <IconAlert width={14} height={14} />
                  <span>{job.error}</span>
                </div>
              )}

              {job.status === 'done' && job.outputPath && (
                <div className="job__path" title={job.outputPath}>
                  <IconCheck width={12} height={12} />
                  {shortPath(job.outputPath, 64)}
                </div>
              )}

              {isOpen && (
                <pre className="job__log">{job.log.slice(-60).join('\n')}</pre>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function statusLabel(s: Job['status']): string {
  switch (s) {
    case 'queued':
      return '排队中'
    case 'downloading':
      return '下载中'
    case 'converting':
      return '转换中'
    case 'done':
      return '已完成'
    case 'error':
      return '失败'
    case 'canceled':
      return '已取消'
    case 'probing':
      return '解析中'
    default:
      return s
  }
}
