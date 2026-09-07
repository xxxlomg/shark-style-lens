import { HighlightLayer } from './HighlightLayer'
import { PromptPanel } from './PromptPanel'
import { StatusChip } from './StatusChip'
import { useAnalysisStore, useSelectionStore } from '../state/stores'

/** 浮层根组件：按模式/状态组合 UI */
export function App() {
  const mode = useSelectionStore((s) => s.mode)
  const status = useAnalysisStore((s) => s.status)

  return (
    <>
      {mode === 'idle' && status === 'idle' && <StatusChip />}
      <HighlightLayer />
      {status !== 'idle' && <PromptPanel />}
    </>
  )
}
