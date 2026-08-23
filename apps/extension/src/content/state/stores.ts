import { create } from 'zustand'

/* SelectionState（§61） */
export type SelectionMode = 'idle' | 'selecting' | 'locked'

interface SelectionState {
  mode: SelectionMode
  targetId?: string
  setMode: (mode: SelectionMode) => void
  setTarget: (targetId?: string) => void
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  mode: 'idle',
  setMode: (mode) => set({ mode }),
  setTarget: (targetId) => set({ targetId }),
}))

/* AnalysisState（§61） */
export type AnalysisStatus =
  'idle' | 'collecting' | 'analyzing' | 'streaming' | 'complete' | 'error'

interface AnalysisState {
  status: AnalysisStatus
  progress: number
  setStatus: (status: AnalysisStatus) => void
  setProgress: (progress: number) => void
}

export const useAnalysisStore = create<AnalysisState>()((set) => ({
  status: 'idle',
  progress: 0,
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
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
