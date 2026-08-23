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
    /* 存储失败不影响拖拽 */
  }
}
