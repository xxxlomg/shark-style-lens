/**
 * UI 状态机
 *
 *   IDLE → SELECTING → SELECTED → ANALYZING → GENERATING → COMPLETED
 *                              ↘            ↘
 *                               ERROR ←──────┘
 * 任何状态可回 SELECTING（re-select，含流式中止）；ERROR 可回 SELECTING 或 IDLE（取消）。
 */
export type UiState =
  'idle' | 'selecting' | 'selected' | 'analyzing' | 'generating' | 'completed' | 'error'

export type UiEvent =
  | { type: 'START_SELECT' }
  | { type: 'CANCEL' }
  | { type: 'ELEMENT_SELECTED' }
  | { type: 'RE_SELECT' }
  | { type: 'ANALYZE' }
  | { type: 'PROMPT_START' }
  | { type: 'PROMPT_COMPLETE' }
  | { type: 'FAIL' }

const TRANSITIONS: Record<UiState, Partial<Record<UiEvent['type'], UiState>>> = {
  idle: { START_SELECT: 'selecting' },
  selecting: { ELEMENT_SELECTED: 'selected', CANCEL: 'idle' },
  selected: { ANALYZE: 'analyzing', RE_SELECT: 'selecting', CANCEL: 'idle' },
  // 分析/流式中允许 RE_SELECT / CANCEL（中止并回到选择或空闲，配合 PROMPT_CANCEL 中止后端流）
  analyzing: { PROMPT_START: 'generating', FAIL: 'error', RE_SELECT: 'selecting', CANCEL: 'idle' },
  generating: {
    PROMPT_COMPLETE: 'completed',
    FAIL: 'error',
    RE_SELECT: 'selecting',
    CANCEL: 'idle',
  },
  completed: { RE_SELECT: 'selecting', START_SELECT: 'selecting', CANCEL: 'idle' },
  error: { RE_SELECT: 'selecting', START_SELECT: 'selecting', CANCEL: 'idle' },
}

export function transition(state: UiState, event: UiEvent): UiState {
  const next = TRANSITIONS[state][event.type]
  if (!next) {
    throw new Error(`Illegal UI transition: ${state} --${event.type}--> ?`)
  }
  return next
}
