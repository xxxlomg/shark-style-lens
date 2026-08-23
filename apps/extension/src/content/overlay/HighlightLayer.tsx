import { useEffect, useRef } from 'react'
import {
  clearTarget,
  currentHoverEl,
  lockElement,
  setCurrentHover,
  startAnalysis,
} from '../selector/lock'
import { dispatchUi } from '../state/ui-controller'
import { useAnalysisStore, useSelectionStore } from '../state/stores'
import { SelectionControl } from './SelectionControl'

/**
 * 选择层：hover 高亮 + tooltip（§4.1）+ 点击锁定（§4.2）+ 键盘（§4.3）。
 * 热路径（mousemove）用 rAF 直接操作 DOM，不触发 React 重渲染。
 */
export function HighlightLayer() {
  const mode = useSelectionStore((s) => s.mode)
  const target = useSelectionStore((s) => s.target)
  const status = useAnalysisStore((s) => s.status)
  const outlineRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const hideHover = () => {
    setCurrentHover(null)
    if (outlineRef.current) outlineRef.current.style.display = 'none'
    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
  }

  // hover 跟踪（仅 selecting 模式；mousemove 只算 elementFromPoint + rect，§38）
  useEffect(() => {
    if (mode !== 'selecting') return
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        if (!el || el.id === 'stylelens-root' || el.closest?.('#stylelens-root')) {
          hideHover()
          return
        }
        setCurrentHover(el)
        const rect = el.getBoundingClientRect()
        const o = outlineRef.current
        if (o) {
          o.style.display = 'block'
          o.style.left = `${rect.left}px`
          o.style.top = `${rect.top}px`
          o.style.width = `${rect.width}px`
          o.style.height = `${rect.height}px`
        }
        const t = tooltipRef.current
        if (t) {
          const label = `<${el.tagName.toLowerCase()}>`
          const cls = Array.from(el.classList).slice(0, 3).join(' ')
          t.textContent =
            `${label} ${cls} ${Math.round(rect.width)} × ${Math.round(rect.height)}`.trim()
          t.style.display = 'block'
          const top = rect.top - 30 < 0 ? rect.bottom + 4 : rect.top - 30
          t.style.top = `${top}px`
          t.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 300))}px`
        }
      })
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
      hideHover()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // 点击锁定（capture 阶段拦截，避免触发页面处理）
  useEffect(() => {
    if (mode !== 'selecting') return
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('#stylelens-root')) return
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      if (!el || el.id === 'stylelens-root') return
      e.preventDefault()
      e.stopPropagation()
      lockElement(el)
      dispatchUi({ type: 'ELEMENT_SELECTED' })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [mode])

  // 键盘：Esc 取消 / Enter 确认（§4.3 / §59.1）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === 'selecting') {
        if (e.key === 'Escape') {
          e.preventDefault()
          dispatchUi({ type: 'CANCEL' })
          clearTarget()
        } else if (e.key === 'Enter' && currentHoverEl) {
          e.preventDefault()
          lockElement(currentHoverEl)
          dispatchUi({ type: 'ELEMENT_SELECTED' })
        }
      } else if (mode === 'locked') {
        if (e.key === 'Escape') {
          e.preventDefault()
          dispatchUi({ type: 'CANCEL' })
          clearTarget()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          dispatchUi({ type: 'ANALYZE' })
          startAnalysis()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode])

  return (
    <>
      {/* hover 高亮 outline */}
      <div
        id="stylelens-hover-outline"
        ref={outlineRef}
        style={{ display: 'none' }}
        className="pointer-events-none fixed z-[2147483646] border-2 border-indigo-500 bg-indigo-500/10"
      />
      {/* hover tooltip */}
      <div
        id="stylelens-tooltip"
        ref={tooltipRef}
        style={{ display: 'none' }}
        className="pointer-events-none fixed z-[2147483646] max-w-[300px] truncate rounded-md bg-slate-900/90 px-2 py-1 text-xs font-mono text-white"
      />
      {/* 锁定后的控制 UI（§4.2）：分析进行中隐藏，面板接管并锚定在控制条原位置 */}
      {mode === 'locked' && status === 'idle' && target && <SelectionControl target={target} />}
    </>
  )
}
