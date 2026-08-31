export const SETTINGS_KEY = 'stylelens.settings'
export const DEFAULT_API_BASE = 'http://127.0.0.1:3001'
export const DEFAULT_API_SECRET = 'stylelens-dev'

const LOCAL_API_HOSTS = new Set(['127.0.0.1', 'localhost'])

export interface ExtensionSettings {
  apiBaseUrl?: string
  apiSecret?: string
}

export function isLocalApiBase(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      LOCAL_API_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '') &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function resolveApiBase(value?: string): string {
  if (!value || !isLocalApiBase(value)) return DEFAULT_API_BASE
  return new URL(value).origin
}

export async function getExtensionSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY)
    return (result[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {}
  } catch {
    return {}
  }
}

export function apiConnection(settings: ExtensionSettings): { base: string; secret: string } {
  return {
    base: resolveApiBase(settings.apiBaseUrl),
    secret: settings.apiSecret?.trim() || DEFAULT_API_SECRET,
  }
}
