import type { SelectedElement } from '../../shared/schemas/messages'
import { clearTarget, setTargetScope, startAnalysis } from '../selector/lock'
import { dispatchUi } from '../state/ui-controller'

/** 锁定态控制条（§4.2）：Analyze / Re-select / Component scope */
export function SelectionControl({ target }: { target: SelectedElement }) {
  const left = Math.max(4, Math.min(target.rect.left, window.innerWidth - 340))
  const top = Math.min(target.rect.bottom + 8, window.innerHeight - 48)

  return (
    <div
      id="stylelens-selection-control"
      className="pointer-events-auto fixed z-[2147483646] flex items-center gap-2 rounded-lg bg-slate-900/95 px-3 py-2 text-white shadow-xl"
      style={{ left, top }}
    >
      <span className="max-w-[120px] truncate text-xs text-slate-300">{target.tagName}</span>
      <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-200">
        {target.scope === 'element' ? 'Element' : 'Component'}
      </span>
      <button
        type="button"
        className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-semibold hover:bg-indigo-400"
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
          dispatchUi({ type: 'RE_SELECT' })
          clearTarget()
        }}
      >
        Re-select
      </button>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
        onClick={() => setTargetScope(target.scope === 'element' ? 'component' : 'element')}
      >
        Component
      </button>
    </div>
  )
}
