import { useAnalysisStore, useSelectionStore } from '../state/stores'

/** 空闲态角落状态芯片（非选择/分析时显示） */
export function StatusChip() {
  const mode = useSelectionStore((s) => s.mode)
  const status = useAnalysisStore((s) => s.status)

  return (
    <div className="pointer-events-auto fixed right-4 bottom-4 rounded-xl bg-slate-900/90 px-4 py-3 text-white shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tracking-wide">StyleLens</span>
        <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-xs text-indigo-200">
          {mode} · {status}
        </span>
      </div>
    </div>
  )
}
