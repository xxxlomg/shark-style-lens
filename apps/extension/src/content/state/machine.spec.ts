import { describe, expect, it } from 'vitest'
import { transition, type UiEvent, type UiState } from './machine'

describe('UI state machine (§47)', () => {
  const cases: Array<{ from: UiState; event: UiEvent; to: UiState }> = [
    { from: 'idle', event: { type: 'START_SELECT' }, to: 'selecting' },
    { from: 'selecting', event: { type: 'ELEMENT_SELECTED' }, to: 'selected' },
    { from: 'selecting', event: { type: 'CANCEL' }, to: 'idle' },
    { from: 'selected', event: { type: 'ANALYZE' }, to: 'analyzing' },
    { from: 'selected', event: { type: 'RE_SELECT' }, to: 'selecting' },
    { from: 'analyzing', event: { type: 'PROFILE_READY' }, to: 'generating' },
    { from: 'analyzing', event: { type: 'FAIL' }, to: 'error' },
    { from: 'generating', event: { type: 'PROMPT_COMPLETE' }, to: 'completed' },
    { from: 'generating', event: { type: 'FAIL' }, to: 'error' },
    { from: 'completed', event: { type: 'RE_SELECT' }, to: 'selecting' },
    { from: 'error', event: { type: 'RE_SELECT' }, to: 'selecting' },
    { from: 'error', event: { type: 'CANCEL' }, to: 'idle' },
  ]

  it.each(cases)('$from --$event.type--> $to', ({ from, event, to }) => {
    expect(transition(from, event)).toBe(to)
  })

  it('rejects illegal transitions', () => {
    expect(() => transition('idle', { type: 'ANALYZE' })).toThrow(/Illegal/)
    expect(() => transition('selecting', { type: 'PROMPT_COMPLETE' })).toThrow(/Illegal/)
    expect(() => transition('completed', { type: 'ANALYZE' })).toThrow(/Illegal/)
  })
})
