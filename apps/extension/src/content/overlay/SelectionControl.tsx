import type { SelectedElement } from '../../shared/schemas/messages'
import { cancelActivePrompt, clearTarget, setTargetScope, startAnalysis } from '../selector/lock'
import { dispatchUi } from '../state/ui-controller'
import { controlPosition } from './control-position'

/** 锁定态控制条（§4.2）：Analyze / Re-select / Element·Component 分段切换 */
export function SelectionControl({ target }: { target: SelectedElement }) {
  const { left, top } = controlPosition(target)
  const scope = target.scope

  return (
    <div
      id="stylelens-selection-control"
      className="pointer-events-auto fixed z-[2147483646] flex items-center gap-2 rounded-lg bg-slate-900/95 px-3 py-2 text-white shadow-xl"
      style={{ left, top }}
    >
      <span className="max-w-[110px] truncate text-xs text-slate-300">{target.tagName}</span>

      {/* Element / Component 分段切换（当前项高亮，反馈清晰） */}
      <div className="flex rounded-md bg-white/10 p-0.5 text-[11px]">
        <button
          type="button"
          className={`rounded px-2 py-0.5 transition-colors ${
            scope === 'element'
              ? 'bg-emerald-500 font-semibold text-white'
              : 'text-slate-300 hover:bg-white/10'
          }`}
          onClick={() => setTargetScope('element')}
        >
          Element
        </button>
        <button
          type="button"
          className={`rounded px-2 py-0.5 transition-colors ${
            scope === 'component'
              ? 'bg-emerald-500 font-semibold text-white'
              : 'text-slate-300 hover:bg-white/10'
          }`}
          onClick={() => setTargetScope('component')}
        >
          Component
        </button>
      </div>

      <button
        type="button"
        className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold hover:bg-emerald-400"
        onClick={() => {
          dispatchUi({ type: 'ANALYZE' })
          startAnalysis()
        }}
      >
        Analyze
      </button>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
        onClick={() => {
          cancelActivePrompt()
          dispatchUi({ type: 'RE_SELECT' })
          clearTarget()
        }}
      >
        Re-select
      </button>
    </div>
  )
}
