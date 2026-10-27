import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TipState {
  text: string
  x: number
  y: number
  place: 'top' | 'bottom'
}

const EDGE = 8

/**
 * 全局悬停提示层。
 *
 * 直接读取元素上的 data-tip 属性，把提示渲染到 body 的 portal 里（position: fixed）。
 * 这样提示不会被任何祖先元素的 overflow 裁切，也不会被背景层级压住——
 * 用纯 CSS 的 ::after 做不到这一点（父容器 overflow:hidden 会把提示整个切掉）。
 *
 * 位置还会做边界收敛：贴着窗口左右边缘的按钮（例如音量），
 * 提示居中后可能超出视口，这里会把它推回可视范围内。
 */
export default function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<TipState | null>(null)
  /** 水平修正量：提示超出视口时把它推回来 */
  const [nudge, setNudge] = useState(0)
  const tipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let timer = 0

    const hide = (): void => {
      window.clearTimeout(timer)
      setTip(null)
      setNudge(0)
    }

    const onOver = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      const el = target?.closest?.('[data-tip]') as HTMLElement | null
      if (!el) return
      const text = el.getAttribute('data-tip')?.trim()
      if (!text) return
      if (el.getAttribute('data-tip-disabled') === 'true') return

      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return
        // 上方放不下就翻到下方
        const place: 'top' | 'bottom' = r.top < 44 ? 'bottom' : 'top'
        setNudge(0)
        setTip({
          text,
          x: r.left + r.width / 2,
          y: place === 'top' ? r.top - 8 : r.bottom + 8,
          place
        })
      }, 130)
    }

    const onOut = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      const el = target?.closest?.('[data-tip]') as HTMLElement | null
      if (el) hide()
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    // 点击、滚动、窗口失焦时立刻收起，避免提示残留
    document.addEventListener('mousedown', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('mousedown', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // 渲染后测量实际宽度，把提示收敛到视口内
  useLayoutEffect(() => {
    if (!tip) return
    const el = tipRef.current
    if (!el) return
    const half = el.offsetWidth / 2
    const minX = half + EDGE
    const maxX = window.innerWidth - half - EDGE
    let delta = 0
    if (tip.x < minX) delta = minX - tip.x
    else if (tip.x > maxX) delta = maxX - tip.x
    setNudge((prev) => (Math.abs(prev - delta) < 0.5 ? prev : delta))
  }, [tip])

  if (!tip) return null

  return createPortal(
    <div
      ref={tipRef}
      className="aurora-tooltip"
      role="tooltip"
      style={{
        left: tip.x + nudge,
        top: tip.y,
        transform: tip.place === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
      }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
