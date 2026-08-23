import { transition, type UiEvent } from './machine'
import { useAnalysisStore, useSelectionStore } from './stores'

/** 清空分析状态：面板消失、Prompt/Profile/错误不留残留（Re-select / 取消时调用） */
function resetAnalysis() {
  const analysis = useAnalysisStore.getState()
  analysis.setStatus('idle')
  analysis.setProgress(0)
  analysis.resetPrompt()
  analysis.setProfile(undefined)
  analysis.setError(undefined)
}

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
      resetAnalysis()
      break
    case 'selecting':
      useSelectionStore.getState().setMode('selecting')
      resetAnalysis()
      break
    case 'selected':
      useSelectionStore.getState().setMode('locked')
      resetAnalysis()
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
