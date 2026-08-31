const KEY = 'stylelens.panelPosition'

export interface PanelPosition {
  x: number
  y: number
  userMoved: boolean
}

export async function getPanelPosition(): Promise<PanelPosition | null> {
  try {
    const res = await chrome.storage.local.get(KEY)
    return (res[KEY] as PanelPosition | undefined) ?? null
  } catch {
    return null
  }
}

export async function setPanelPosition(pos: PanelPosition) {
  try {
    await chrome.storage.local.set({ [KEY]: pos })
  } catch {
    // 存储失败不影响拖拽
  }
}

const CHIP_KEY = 'stylelens.chipPosition'

export interface ChipPosition {
  x: number
  y: number
}

export async function getChipPosition(): Promise<ChipPosition | null> {
  try {
    const res = await chrome.storage.local.get(CHIP_KEY)
    return (res[CHIP_KEY] as ChipPosition | undefined) ?? null
  } catch {
    return null
  }
}

export async function setChipPosition(pos: ChipPosition) {
  try {
    await chrome.storage.local.set({ [CHIP_KEY]: pos })
  } catch {
    // 存储失败不影响拖拽
  }
}
