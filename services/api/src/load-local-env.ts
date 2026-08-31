import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

export function loadLocalEnv(fileUrl?: URL) {
  // STYLELENS_ENV_FILE='' 显式跳过 .env（e2e 强制 mock，避免机器上的真实 Key 生效）
  const override = process.env.STYLELENS_ENV_FILE
  if (override === '') return
  // Use the package working directory so the bundled CJS sidecar does not
  // depend on import.meta.url. The desktop host explicitly disables this.
  const target = fileUrl ?? resolve(process.cwd(), override ?? '.env')
  try {
    applyEnvValues(parseEnv(readFileSync(target, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
