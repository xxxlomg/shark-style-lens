import { useEffect, useRef, useState } from 'react'
import { getPanelPosition, setPanelPosition } from '../bridge/storage'
import { useAnalysisStore, useOverlayStore, useSelectionStore } from '../state/stores'

const PANEL_W = 380
const PANEL_H = 280
const PHASES = [
  'Preparing analysis…',
  'Inspecting structure…',
  'Understanding layout…',
  'Collecting styles…',
  'Building profile…',
] as const

/**
 * 浮空结果面板（§29 / §58.3）：
 * 初次生成定位在目标附近（Anchored）；用户拖拽后脱离（Floating）并记忆位置。
 * Sprint 4 接入流式 Prompt 渲染。
 */
export function PromptPanel() {
  const status = useAnalysisStore((s) => s.status)
  const target = useSelectionStore((s) => s.target)
  const setPosition = useOverlayStore((s) => s.setPosition)

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const anchoredRef = useRef(false)

  const applyPos = (p: { x: number; y: number }) => {
    posRef.current = p
    setPos(p)
  }

  // 面板首次出现时决定初始位置（Anchored 或恢复记忆位置）
  useEffect(() => {
    if (status === 'idle' || posRef.current) return
    let cancelled = false
    void (async () => {
      const saved = await getPanelPosition()
      if (cancelled) return
      if (saved?.userMoved) {
        applyPos({ x: saved.x, y: saved.y })
        setPosition(saved.x, saved.y, true)
      } else if (target && !anchoredRef.current) {
        anchoredRef.current = true
        let x = target.rect.right + 16
        let y = target.rect.top
        x = Math.max(8, Math.min(x, window.innerWidth - PANEL_W - 8))
        y = Math.max(8, Math.min(y, window.innerHeight - PANEL_H - 8))
        applyPos({ x, y })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const p = posRef.current
    if (!p) return
    dragRef.current = { dx: e.clientX - p.x, dy: e.clientY - p.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    const nx = Math.max(0, Math.min(e.clientX - d.dx, window.innerWidth - 60))
    const ny = Math.max(0, Math.min(e.clientY - d.dy, window.innerHeight - 40))
    applyPos({ x: nx, y: ny })
    setPosition(nx, ny, true)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    const p = posRef.current
    if (p) {
      setPosition(p.x, p.y, true)
      void setPanelPosition({ x: p.x, y: p.y, userMoved: true })
    }
  }

  const analyzing = status === 'analyzing' || status === 'collecting'

  return (
    <div
      id="stylelens-prompt-panel"
      className="pointer-events-auto fixed z-[2147483646] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 text-white shadow-2xl backdrop-blur"
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: PANEL_W, height: PANEL_H }}
    >
      {/* 拖拽把手 */}
      <div
        id="stylelens-panel-header"
        className="flex cursor-grab items-center justify-between border-b border-white/10 px-4 py-2.5 select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold tracking-wide">StyleLens</span>
        <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-[10px] text-indigo-200">
          {analyzing ? 'Analyzing' : status}
        </span>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {analyzing && (
          <div>
            <p className="mb-2 text-slate-200">Analyzing component…</p>
            <ul className="space-y-1.5">
              {PHASES.map((phase) => (
                <li key={phase} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-600" />
                  {phase}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Analyzer engine lands in Sprint 3 · prompt streaming in Sprint 4.
            </p>
          </div>
        )}
        {!analyzing && (
          <p className="text-xs text-slate-400">
            {status === 'complete'
              ? 'Prompt ready — streaming UI lands in Sprint 4.'
              : status === 'error'
                ? 'Analysis failed. Try re-selecting.'
                : 'Waiting for analysis…'}
          </p>
        )}
      </div>

      {/* 底部 Copy（Sprint 4 启用） */}
      <div className="border-t border-white/10 px-4 py-2.5">
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-md bg-indigo-500/40 px-3 py-1.5 text-xs font-semibold text-indigo-200"
        >
          Copy Prompt
        </button>
      </div>
    </div>
  )
}
