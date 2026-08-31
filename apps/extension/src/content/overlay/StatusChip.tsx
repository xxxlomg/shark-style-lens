import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getChipPosition, setChipPosition } from '../bridge/storage'
import { dispatchUi } from '../state/ui-controller'
import { BrandMark } from '../../shared/BrandMark'

const EDGE_MARGIN = 16
const SNAP_ZONE = 120 // 释放点距视口左/右边缘小于该值时吸附
const DRAG_THRESHOLD = 4 // 位移小于该值视为点击而非拖拽

/**
 * 空闲态状态芯片（§49.1）：不暴露内部状态名，显示友好提示；
 * 支持自由拖拽 + 左右边缘吸附 + 位置记忆（与 Prompt 面板一致的交互），
 * 位移超过阈值才判定为拖拽，避免吞掉点击进入选择模式（发现入口之一）。
 */
export function StatusChip() {
  const chipRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [snapping, setSnapping] = useState(false)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number; startX: number; startY: number } | null>(null)
  const movedRef = useRef(false)

  const applyPos = (p: { x: number; y: number }) => {
    posRef.current = p
    setPos(p)
  }

  const clamp = (x: number, y: number) => {
    const el = chipRef.current
    const w = el?.offsetWidth ?? 0
    const h = el?.offsetHeight ?? 0
    return {
      x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - w))),
      y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - h))),
    }
  }

  // 首次挂载：默认落位右下角区域（仅为初始落点，不再强制固定），
  // 若用户曾拖拽过则恢复记忆位置
  useLayoutEffect(() => {
    const el = chipRef.current
    if (!el) return
    applyPos(
      clamp(
        window.innerWidth - el.offsetWidth - EDGE_MARGIN,
        window.innerHeight - el.offsetHeight - EDGE_MARGIN,
      ),
    )
    let cancelled = false
    void getChipPosition().then((saved) => {
      if (cancelled || !saved) return
      setSnapping(true)
      applyPos(clamp(saved.x, saved.y))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 视口尺寸变化时把芯片收回可见区域
  useEffect(() => {
    const onResize = () => {
      const p = posRef.current
      if (!p) return
      setSnapping(false)
      applyPos(clamp(p.x, p.y))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const p = posRef.current
    if (!p) return
    movedRef.current = false
    setSnapping(false)
    dragRef.current = {
      dx: e.clientX - p.x,
      dy: e.clientY - p.y,
      startX: e.clientX,
      startY: e.clientY,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    if (
      !movedRef.current &&
      Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD
    ) {
      return
    }
    movedRef.current = true
    applyPos(clamp(e.clientX - d.dx, e.clientY - d.dy))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    const el = chipRef.current
    const p = posRef.current
    if (!el || !p || !movedRef.current) return
    // 边缘吸附：靠近左/右边缘释放时平滑吸附到该侧
    let next = p
    const leftDist = p.x
    const rightDist = window.innerWidth - (p.x + el.offsetWidth)
    if (Math.min(leftDist, rightDist) <= SNAP_ZONE) {
      const snapX =
        leftDist <= rightDist ? EDGE_MARGIN : window.innerWidth - el.offsetWidth - EDGE_MARGIN
      next = clamp(snapX, p.y)
    }
    setSnapping(true)
    applyPos(next)
    void setChipPosition(next)
  }

  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    // 拖拽结束后的合成 click 不触发选择模式
    if (movedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      movedRef.current = false
      return
    }
    dispatchUi({ type: 'START_SELECT' })
  }

  return (
    <button
      ref={chipRef}
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`pointer-events-auto fixed z-[2147483646] flex w-max touch-none select-none items-center gap-1.5 whitespace-nowrap rounded-xl bg-slate-900/90 px-3 py-2.5 text-white shadow-2xl backdrop-blur hover:bg-slate-800 ${
        snapping
          ? 'cursor-grab transition-[left,top] duration-200 ease-out'
          : 'cursor-grab transition-colors active:cursor-grabbing'
      }`}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      title="Click to start selection · drag to move"
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold tracking-wide">
        <BrandMark className="h-5 w-5 rounded-md" />
        StyleLens
      </span>
      <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-200">
        Ready · Alt+Shift+S
      </span>
    </button>
  )
}
