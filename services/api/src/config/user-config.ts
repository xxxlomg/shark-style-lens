import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const USER_CONFIG_VERSION = 1

export type ReasoningEffort = 'low' | 'high' | 'max'

export interface UserConfig {
  version: number
  provider: {
    name: 'deepseek'
    apiKey: string
    baseUrl: string
    agentModel: string
    visionModel: string
  }
  thinkingEnabled: boolean
  reasoningEffort: ReasoningEffort
  api: {
    port: number
  }
}

export interface UserConfigPatch {
  apiKey?: string
  baseUrl?: string
  agentModel?: string
  visionModel?: string
  thinkingEnabled?: boolean
  reasoningEffort?: ReasoningEffort
}

export interface PublicUserConfig {
  configPath: string
  configured: boolean
  provider: 'deepseek'
  apiKeyConfigured: boolean
  apiKeyHint: string | null
  baseUrl: string
  agentModel: string
  visionModel: string
  thinkingEnabled: boolean
  reasoningEffort: ReasoningEffort
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_AGENT_MODEL = 'deepseek-v4-flash'
const DEFAULT_VISION_MODEL = 'deepseek-v4-flash-vision-exp'

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The API key is sent to `${baseUrl}/chat/completions`. Keep configuration
 * limited to the official DeepSeek host or a loopback development proxy.
 */
export function isAllowedProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const isOfficial = url.protocol === 'https:' && url.hostname === 'api.deepseek.com'
    const isLoopback =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
    return (
      (isOfficial || isLoopback) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

function safeBaseUrl(value: unknown, fallback: string): string {
  const candidate = nonEmpty(value)
  return candidate && isAllowedProviderBaseUrl(candidate) ? candidate : fallback
}

export function getUserConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = nonEmpty(env.STYLELENS_CONFIG_DIR)
  if (configured) return resolve(configured)

  const appData = nonEmpty(env.APPDATA)
  if (appData) return join(appData, 'shark', 'shark-style-lens')

  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'shark', 'shark-style-lens')
  }

  const configHome = nonEmpty(env.XDG_CONFIG_HOME) ?? join(homedir(), '.config')
  return join(configHome, 'shark', 'shark-style-lens')
}

export function getUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = nonEmpty(env.STYLELENS_CONFIG_FILE)
  return configured ? resolve(configured) : join(getUserConfigDir(env), 'config.json')
}

export function defaultUserConfig(env: NodeJS.ProcessEnv = process.env): UserConfig {
  return {
    version: USER_CONFIG_VERSION,
    provider: {
      name: 'deepseek',
      apiKey: '',
      baseUrl: DEFAULT_BASE_URL,
      agentModel: DEFAULT_AGENT_MODEL,
      visionModel: DEFAULT_VISION_MODEL,
    },
    thinkingEnabled: false,
    reasoningEffort: 'high',
    api: { port: 3001 },
  }
}

function normalizeConfig(value: unknown, env: NodeJS.ProcessEnv): UserConfig {
  const defaults = defaultUserConfig(env)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults

  const input = value as Record<string, unknown>
  const provider =
    input.provider && typeof input.provider === 'object' && !Array.isArray(input.provider)
      ? (input.provider as Record<string, unknown>)
      : {}
  const api =
    input.api && typeof input.api === 'object' && !Array.isArray(input.api)
      ? (input.api as Record<string, unknown>)
      : {}
  const port = Number(api.port)
  const reasoningEffort = input.reasoningEffort

  return {
    version: USER_CONFIG_VERSION,
    provider: {
      name: 'deepseek',
      apiKey: typeof provider.apiKey === 'string' ? provider.apiKey.trim() : '',
      baseUrl: safeBaseUrl(provider.baseUrl, defaults.provider.baseUrl),
      agentModel: nonEmpty(provider.agentModel) ?? defaults.provider.agentModel,
      visionModel: nonEmpty(provider.visionModel) ?? defaults.provider.visionModel,
    },
    thinkingEnabled: input.thinkingEnabled === true,
    reasoningEffort:
      reasoningEffort === 'low' || reasoningEffort === 'high' || reasoningEffort === 'max'
        ? reasoningEffort
        : defaults.reasoningEffort,
    api: {
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : defaults.api.port,
    },
  }
}

export function readUserConfig(
  env: NodeJS.ProcessEnv = process.env,
  filePath = getUserConfigPath(env),
): UserConfig {
  try {
    return normalizeConfig(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, env)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[StyleLens API] config:read-failed', {
        configPath: filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return defaultUserConfig(env)
  }
}

export function writeUserConfig(
  patch: UserConfigPatch,
  env: NodeJS.ProcessEnv = process.env,
  filePath = getUserConfigPath(env),
): UserConfig {
  const current = readUserConfig(env, filePath)
  const next = normalizeConfig(
    {
      ...current,
      provider: {
        ...current.provider,
        ...(patch.apiKey === undefined ? {} : { apiKey: patch.apiKey }),
        ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
        ...(patch.agentModel === undefined ? {} : { agentModel: patch.agentModel }),
        ...(patch.visionModel === undefined ? {} : { visionModel: patch.visionModel }),
      },
      ...(patch.thinkingEnabled === undefined ? {} : { thinkingEnabled: patch.thinkingEnabled }),
      ...(patch.reasoningEffort === undefined ? {} : { reasoningEffort: patch.reasoningEffort }),
    },
    env,
  )

  mkdirSync(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    renameSync(temporary, filePath)
  } catch (error) {
    // Windows cannot always replace an existing file with renameSync.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    rmSync(temporary, { force: true })
  }
  return next
}

export function toPublicUserConfig(
  config: UserConfig,
  env: NodeJS.ProcessEnv = process.env,
  filePath = getUserConfigPath(env),
): PublicUserConfig {
  const key = config.provider.apiKey
  return {
    configPath: filePath,
    configured: Boolean(key),
    provider: config.provider.name,
    apiKeyConfigured: Boolean(key),
    apiKeyHint: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : null,
    baseUrl: config.provider.baseUrl,
    agentModel: config.provider.agentModel,
    visionModel: config.provider.visionModel,
    thinkingEnabled: config.thinkingEnabled,
    reasoningEffort: config.reasoningEffort,
  }
}
