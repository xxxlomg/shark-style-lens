import { dispatchUi } from '../state/ui-controller'
import { BrandMark } from '../../shared/BrandMark'

/**
 * 空闲态状态芯片：不暴露内部状态名（§49.1），显示友好提示；
 * 点击即进入选择模式（发现入口之一）。
 */
export function StatusChip() {
  return (
    <button
      type="button"
      onClick={() => dispatchUi({ type: 'START_SELECT' })}
      className="pointer-events-auto fixed right-4 bottom-4 flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900/90 px-4 py-2.5 text-white shadow-2xl backdrop-blur transition hover:bg-slate-800"
      title="Start element selection"
    >
      <span className="flex items-center gap-2 text-sm font-semibold tracking-wide">
        <BrandMark className="h-5 w-5 rounded-md" />
        StyleLens
      </span>
      <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-[11px] text-indigo-200">
        Ready · Alt+Shift+S
      </span>
    </button>
  )
}
