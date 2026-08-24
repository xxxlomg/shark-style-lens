import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * Apply values from the project .env after Node's native env-file loading.
 * This makes an explicit empty value (for example DEEPSEEK_API_KEY=) clear a
 * stale inherited variable from a parent shell or an older dev process.
 */
export function applyEnvValues(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }
}

export function loadLocalEnv(fileUrl = new URL('../.env', import.meta.url)) {
  try {
    applyEnvValues(parseEnv(readFileSync(fileUrl, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
