import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconChevron } from './Icons'

export interface DropdownOption {
  value: string
  label: string
  /** 可选的补充说明，显示在标签下方 */
  hint?: string
}

interface Props {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  /** 触发按钮额外 className */
  className?: string
  disabled?: boolean
  /** 浮层宽度，默认跟随触发按钮 */
  panelWidth?: number
}

/**
 * 自绘下拉框。
 *
 * 为什么不用原生 <select>：在透明/亚克力无边框窗口里，Chromium 的原生下拉弹层
 * 由操作系统单独绘制，层级不受页面控制，实测会被窗口背景遮住。
 * 这里改为渲染到 document.body 的 portal（position: fixed），
 * 层级永远在最上层，且不依赖任何祖先元素的 overflow 裁切。
 */
export default function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  disabled = false,
  panelWidth
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; openUp: boolean } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const current = options.find((o) => o.value === value)

  const measure = useCallback((): void => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = panelWidth ?? Math.max(r.width, 180)
    // 估算面板高度：每项约 34px + 内边距 12px
    const est = Math.min(options.length * 34 + 12, 320)
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < est + 12 && r.top > est + 12
    setRect({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: openUp ? r.top - est - 6 : r.bottom + 6,
      width,
      openUp
    })
  }, [options.length, panelWidth])

  useLayoutEffect(() => {
    if (open) measure()
  }, [open, measure])

  useEffect(() => {
    if (!open) return

    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    const close = (): void => setOpen(false)

    // capture 阶段监听，避免被内部 stopPropagation 拦截
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)

    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const pick = (v: string): void => {
    onChange(v)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dd ${open ? 'is-open' : ''} ${className}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dd__value">{current?.label ?? '请选择'}</span>
        <IconChevron width={12} height={12} className="dd__chev" />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            className={`dd__panel card ${rect.openUp ? 'is-up' : ''}`}
            role="listbox"
            aria-label={ariaLabel}
            style={{ left: rect.left, top: rect.top, width: rect.width }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`dd__item ${o.value === value ? 'is-active' : ''}`}
                onClick={() => pick(o.value)}
              >
                <span className="dd__item-main">
                  <span className="dd__item-label">{o.label}</span>
                  {o.hint && <span className="dd__item-hint">{o.hint}</span>}
                </span>
                {o.value === value && <span className="dd__check">✓</span>}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
