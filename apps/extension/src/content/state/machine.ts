/**
 * UI 状态机（§47）
 *
 *   IDLE → SELECTING → SELECTED → ANALYZING → GENERATING → COMPLETED
 *                              ↘            ↘
 *                               ERROR ←──────┘
 * 任何状态可回 SELECTING（re-select）；ERROR 可回 SELECTING 或 IDLE（取消）。
 */
export type UiState =
  'idle' | 'selecting' | 'selected' | 'analyzing' | 'generating' | 'completed' | 'error'

export type UiEvent =
  | { type: 'START_SELECT' }
  | { type: 'CANCEL' }
  | { type: 'ELEMENT_SELECTED' }
  | { type: 'RE_SELECT' }
  | { type: 'ANALYZE' }
  | { type: 'PROFILE_READY' }
  | { type: 'PROMPT_COMPLETE' }
  | { type: 'FAIL' }

const TRANSITIONS: Record<UiState, Partial<Record<UiEvent['type'], UiState>>> = {
  idle: { START_SELECT: 'selecting' },
  selecting: { ELEMENT_SELECTED: 'selected', CANCEL: 'idle' },
  selected: { ANALYZE: 'analyzing', RE_SELECT: 'selecting' },
  analyzing: { PROFILE_READY: 'generating', FAIL: 'error' },
  generating: { PROMPT_COMPLETE: 'completed', FAIL: 'error' },
  completed: { RE_SELECT: 'selecting', START_SELECT: 'selecting' },
  error: { RE_SELECT: 'selecting', START_SELECT: 'selecting', CANCEL: 'idle' },
}

export function transition(state: UiState, event: UiEvent): UiState {
  const next = TRANSITIONS[state][event.type]
  if (!next) {
    throw new Error(`Illegal UI transition: ${state} --${event.type}--> ?`)
  }
  return next
}
