import { useAnalysisStore, useSelectionStore } from '../state/stores'

/** MVP 浮层占位：证明 Shadow DOM 隔离 + Tailwind 生效；Sprint 2 替换为完整面板 */
export function App() {
  const mode = useSelectionStore((s) => s.mode)
  const status = useAnalysisStore((s) => s.status)

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 rounded-xl bg-slate-900/90 px-4 py-3 text-white shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tracking-wide">StyleLens</span>
        <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-xs text-indigo-200">
          {mode} · {status}
        </span>
      </div>
    </div>
  )
}
