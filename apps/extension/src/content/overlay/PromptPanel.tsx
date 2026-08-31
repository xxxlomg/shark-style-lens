import { useEffect, useMemo, useRef, useState } from 'react'
import { getPanelPosition, setPanelPosition } from '../bridge/storage'
import { cancelActivePrompt, clearTarget, startAnalysis } from '../selector/lock'
import { dispatchUi } from '../state/ui-controller'
import { useAnalysisStore, useOverlayStore, useSelectionStore } from '../state/stores'
import { controlPosition } from './control-position'
import { BrandMark } from '../../shared/BrandMark'

const PANEL_W = 380
const PANEL_H = 320
const PHASES = [
  { key: 'preparing', label: 'Preparing analysis…', until: 15 },
  { key: 'inspecting-structure', label: 'Inspecting structure…', until: 35 },
  { key: 'understanding-layout', label: 'Understanding layout…', until: 60 },
  { key: 'collecting-styles', label: 'Collecting styles…', until: 85 },
  { key: 'building-profile', label: 'Building profile…', until: 100 },
] as const

/**
 * 浮空结果面板（§29 / §58.3 / §64）：
 * 初次生成锚定在控制条正下方（视觉连续、跟手）；拖拽后脱离（Floating）并记忆位置。
 * Sprint 4：流式 Prompt 渲染 + 自动滚动 + Copy + 错误重试 + Re-select。
 */
export function PromptPanel() {
  const status = useAnalysisStore((s) => s.status)
  const progress = useAnalysisStore((s) => s.progress)
  const profile = useAnalysisStore((s) => s.profile)
  const prompt = useAnalysisStore((s) => s.prompt)
  const reasoning = useAnalysisStore((s) => s.reasoning)
  const error = useAnalysisStore((s) => s.error)
  const target = useSelectionStore((s) => s.target)
  const setPosition = useOverlayStore((s) => s.setPosition)

  // 渲染前同步计算初始锚定位置（控制条正下方，§58.3 跟手），
  // 避免面板先出现在 (0,0) 视口左上角再跳位（“从左边闪出”）
  const initialPos = useMemo(() => {
    if (!target) return null
    const ctrl = controlPosition(target)
    const x = Math.max(8, Math.min(ctrl.left, window.innerWidth - PANEL_W - 8))
    const y = Math.max(8, Math.min(ctrl.top + 48, window.innerHeight - PANEL_H - 8))
    return { x, y }
  }, [target])

  const [pos, setPos] = useState<{ x: number; y: number } | null>(initialPos)
  const posRef = useRef<{ x: number; y: number } | null>(initialPos)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const followScrollRef = useRef(true)
  const [copied, setCopied] = useState(false)

  const applyPos = (p: { x: number; y: number }) => {
    posRef.current = p
    setPos(p)
  }

  // 异步恢复记忆位置（用户曾拖拽过 → Floating）；无记忆则保持初始锚定
  useEffect(() => {
    if (status === 'idle') return
    let cancelled = false
    void (async () => {
      const saved = await getPanelPosition()
      if (cancelled) return
      if (saved?.userMoved) {
        applyPos({ x: saved.x, y: saved.y })
        setPosition(saved.x, saved.y, true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // 流式自动滚动（§64.1：用户上滚后停止强制滚动）
  useEffect(() => {
    const el = scrollRef.current
    if (el && followScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [prompt, reasoning, status])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    followScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30
  }

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

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 降级：textarea 复制
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const retry = () => {
    if (!target) return
    // error → selecting → selected → analyzing，重新分析并触发 Prompt（§4.3 重试）
    cancelActivePrompt()
    dispatchUi({ type: 'RE_SELECT' })
    dispatchUi({ type: 'ELEMENT_SELECTED' })
    dispatchUi({ type: 'ANALYZE' })
    startAnalysis()
  }

  const cancel = () => {
    cancelActivePrompt()
    dispatchUi({ type: 'CANCEL' })
    clearTarget()
  }

  const analyzing = status === 'analyzing' || status === 'collecting'
  const streaming = status === 'streaming'
  const complete = status === 'complete'
  const currentPhaseIdx = PHASES.findIndex((p) => progress <= p.until)
  const badgeText = analyzing
    ? 'Analyzing'
    : streaming
      ? 'Streaming'
      : complete
        ? 'Complete'
        : status === 'error'
          ? 'Failed'
          : status

  return (
    <div
      id="stylelens-prompt-panel"
      className="pointer-events-auto fixed z-[2147483646] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 text-white shadow-2xl backdrop-blur"
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: PANEL_W, height: PANEL_H }}
    >
      {/* 拖拽把手 + 关闭 */}
      <div
        id="stylelens-panel-header"
        className="flex cursor-grab items-center justify-between border-b border-white/10 px-4 py-2.5 select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <BrandMark className="h-5 w-5 rounded-md" />
          StyleLens
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-200">
            {badgeText}
          </span>
          <button
            type="button"
            onClick={cancel}
            className="rounded px-1.5 text-sm leading-none text-slate-400 transition hover:bg-white/10 hover:text-white"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 内容 */}
      {analyzing && (
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          <p className="mb-2 text-slate-200">Analyzing component…</p>
          <ul className="space-y-1.5">
            {PHASES.map((phase, idx) => (
              <li
                key={phase.key}
                className={`flex items-center gap-2 text-xs ${
                  idx < currentPhaseIdx ? 'text-emerald-300' : 'text-slate-400'
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    idx < currentPhaseIdx ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                {phase.key === 'building-profile' && profile
                  ? 'Analyzing visual evidence…'
                  : phase.label}
              </li>
            ))}
          </ul>
          <div className="mt-3 h-1 overflow-hidden rounded bg-slate-700">
            <div
              className="h-full rounded bg-emerald-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {(streaming || complete) && (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap"
        >
          {reasoning.length > 0 && (
            <section className="mb-3 border-b border-white/10 pb-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                Thinking
              </p>
              <span className="font-mono text-slate-400">{reasoning}</span>
            </section>
          )}
          {prompt.length === 0 && reasoning.length === 0 && (
            <p className="text-slate-400">Generating prompt…</p>
          )}
          {prompt.length > 0 && <span className="font-mono text-slate-200">{prompt}</span>}
          {streaming && (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-400" />
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="flex-1 px-4 py-3 text-xs">
          <p className="mb-2 text-rose-300">⚠ {error ?? 'Analysis failed'}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retry}
              className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold hover:bg-emerald-400"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 底部：流式中可立即停止上游请求；完成后可返回选择 + Copy（§64.2） */}
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5">
        {(analyzing || streaming) && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-md bg-rose-500/15 px-2 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/25"
            title="Stop the current AI request"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            cancelActivePrompt()
            dispatchUi({ type: 'RE_SELECT' })
            clearTarget()
          }}
          className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            complete || status === 'error' || status === 'streaming'
              ? 'text-slate-200 hover:bg-white/10'
              : 'cursor-not-allowed text-slate-600'
          }`}
        >
          ↺ Re-select
        </button>
        <button
          type="button"
          onClick={copyPrompt}
          disabled={!complete}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            complete
              ? copied
                ? 'bg-emerald-500 text-white'
                : 'bg-emerald-500 text-white hover:bg-emerald-400'
              : 'cursor-not-allowed bg-emerald-500/40 text-emerald-200'
          }`}
        >
          {copied ? 'Copied ✓' : 'Copy Prompt'}
        </button>
      </div>
    </div>
  )
}
