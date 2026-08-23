import { create } from 'zustand'
import type { StyleProfile } from '../../shared/schemas/style-profile'
import type { SelectedElement } from '../../shared/schemas/messages'
import type { UiState } from './machine'

/* SelectionState（§61） */
export type SelectionMode = 'idle' | 'selecting' | 'locked'

interface SelectionState {
  mode: SelectionMode
  /** UI 状态机当前状态（§47，由 ui-controller 驱动） */
  uiState: UiState
  /** 已锁定的目标元素 */
  target?: SelectedElement
  setMode: (mode: SelectionMode) => void
  setTarget: (target?: SelectedElement) => void
  setUiState: (uiState: UiState) => void
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  mode: 'idle',
  uiState: 'idle',
  setMode: (mode) => set({ mode }),
  setTarget: (target) => set({ target }),
  setUiState: (uiState) => set({ uiState }),
}))

/* AnalysisState（§61） */
export type AnalysisStatus =
  'idle' | 'collecting' | 'analyzing' | 'streaming' | 'complete' | 'error'

interface AnalysisState {
  status: AnalysisStatus
  progress: number
  profile?: StyleProfile
  prompt: string
  error?: string
  setStatus: (status: AnalysisStatus) => void
  setProgress: (progress: number) => void
  setProfile: (profile?: StyleProfile) => void
  appendPrompt: (text: string) => void
  resetPrompt: () => void
  setError: (error?: string) => void
}

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  status: 'idle',
  progress: 0,
  prompt: '',
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setProfile: (profile) => set({ profile }),
  appendPrompt: (text) => set((s) => ({ prompt: s.prompt + text })),
  resetPrompt: () => set({ prompt: '' }),
  setError: (error) => set({ error }),
}))

/* OverlayState（§61） */
interface OverlayState {
  x: number
  y: number
  userMoved: boolean
  setPosition: (x: number, y: number, userMoved?: boolean) => void
}

export const useOverlayStore = create<OverlayState>()((set) => ({
  x: 0,
  y: 0,
  userMoved: false,
  setPosition: (x, y, userMoved = true) => set({ x, y, userMoved }),
}))
