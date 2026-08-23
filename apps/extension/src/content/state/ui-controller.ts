import { transition, type UiEvent } from './machine'
import { useAnalysisStore, useSelectionStore } from './stores'

/**
 * UI 状态机控制器：dispatch 事件 → transition() 校验迁移 → 同步 store（mode / status）。
 * 非法迁移会抛出（transition 内）并在此记录，不静默吞掉。
 */
export function dispatchUi(event: UiEvent) {
  const { uiState } = useSelectionStore.getState()
  let next
  try {
    next = transition(uiState, event)
  } catch (err) {
    console.warn('[StyleLens]', err)
    return
  }
  useSelectionStore.getState().setUiState(next)

  switch (next) {
    case 'idle':
      useSelectionStore.getState().setMode('idle')
      useAnalysisStore.getState().setStatus('idle')
      break
    case 'selecting':
      useSelectionStore.getState().setMode('selecting')
      break
    case 'selected':
      useSelectionStore.getState().setMode('locked')
      useAnalysisStore.getState().setStatus('idle')
      break
    case 'analyzing':
      useAnalysisStore.getState().setStatus('analyzing')
      break
    case 'generating':
      useAnalysisStore.getState().setStatus('streaming')
      break
    case 'completed':
      useAnalysisStore.getState().setStatus('complete')
      break
    case 'error':
      useAnalysisStore.getState().setStatus('error')
      break
  }
}
