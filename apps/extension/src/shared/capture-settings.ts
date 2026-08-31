export const SAVE_CAPTURES_KEY = 'stylelens.saveCaptures'

export async function getSaveCaptures(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(SAVE_CAPTURES_KEY)
    return result[SAVE_CAPTURES_KEY] === true
  } catch {
    return false
  }
}

export async function setSaveCaptures(enabled: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [SAVE_CAPTURES_KEY]: enabled })
  } catch {
    // A storage failure must not block element analysis.
  }
}
