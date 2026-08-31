/**
 * DeepSeek-only model registry.
 *
 * The two slots share the server-side DeepSeek credential and endpoint while
 * keeping their model roles separate: synthesis uses the regular model and
 * visual evidence uses the dedicated vision model.
 */
import { DeepSeekProvider } from './deepseek'
import { MockProvider } from './mock'
import {
  isAllowedProviderBaseUrl,
  readUserConfig,
  type ReasoningEffort,
  type AnalysisMode,
  type UserConfig,
} from '../config/user-config'
import type { PromptProvider } from './types'

export type SlotRole = 'vision' | 'agent'
export type ProviderKind = 'deepseek' | 'mock'

export interface ThinkingConfig {
  enabled: boolean
  reasoningEffort: ReasoningEffort
}

export interface ModelCapabilities {
  vision: boolean
  streaming: boolean
  structuredOutput: boolean
}

export interface SlotConfig {
  role: SlotRole
  provider: ProviderKind
  baseUrl: string
  apiKey: string
  model: string
  label: string
  capabilities: ModelCapabilities
  temperature?: number
  thinking?: ThinkingConfig
}

export interface ModelConfig {
  /** Optional for callers that construct legacy configs; resolved configs always set it. */
  analysisMode?: AnalysisMode
  agent: SlotConfig
  vision: SlotConfig | null
  visionDefaults: {
    imageDetail: 'low' | 'high' | 'original' | 'auto'
    maxImagesPerCall: number
  }
}

/** Correlates provider lifecycle logs without logging prompts, image data, or credentials. */
export interface ProviderRequestLogContext {
  traceId?: string
}

export type VisionDispatch =
  | { kind: 'vision'; slot: SlotConfig }
  | { kind: 'delegate'; slot: SlotConfig }
  | { kind: 'skip'; reason: string }

function nonEmpty(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function configuredValue(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string | undefined,
): string | undefined {
  if (env.STYLELENS_CONFIG_ONLY === '1') return fallback
  if (Object.prototype.hasOwnProperty.call(env, key)) return nonEmpty(env, key)
  return fallback
}

function parseTemperature(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = nonEmpty(env, key)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : undefined
}

function parseImageDetail(env: NodeJS.ProcessEnv): ModelConfig['visionDefaults']['imageDetail'] {
  const value = nonEmpty(env, 'DEEPSEEK_VISION_IMAGE_DETAIL')
  if (value === 'low' || value === 'high' || value === 'original' || value === 'auto') {
    return value
  }
  return 'auto'
}

function parseMaxImages(env: NodeJS.ProcessEnv): number {
  const value = Number(nonEmpty(env, 'DEEPSEEK_VISION_MAX_IMAGES') ?? 4)
  return Number.isInteger(value) && value > 0 && value <= 600 ? value : 4
}

function resolveBaseUrl(env: NodeJS.ProcessEnv, userConfig: UserConfig): string {
  const candidate = configuredValue(env, 'DEEPSEEK_BASE_URL', userConfig.provider.baseUrl) ?? ''
  return isAllowedProviderBaseUrl(candidate) ? candidate : 'https://api.deepseek.com'
}

function resolveAgentSlot(env: NodeJS.ProcessEnv, userConfig: UserConfig): SlotConfig {
  const apiKey = configuredValue(env, 'DEEPSEEK_API_KEY', userConfig.provider.apiKey) ?? ''
  if (!apiKey) {
    return {
      role: 'agent',
      provider: 'mock',
      baseUrl: '',
      apiKey: '',
      model: 'mock',
      label: 'Mock (local test fallback)',
      capabilities: { vision: true, streaming: true, structuredOutput: false },
      thinking: {
        enabled: userConfig.analysisMode !== 'template' && userConfig.thinkingEnabled,
        reasoningEffort: userConfig.reasoningEffort,
      },
    }
  }

  const model = configuredValue(env, 'DEEPSEEK_MODEL', userConfig.provider.agentModel) ?? 'deepseek-v4-flash'
  return {
    role: 'agent',
    provider: 'deepseek',
    baseUrl: resolveBaseUrl(env, userConfig),
    apiKey,
    model,
    label: 'DeepSeek Agent',
    capabilities: { vision: false, streaming: true, structuredOutput: false },
    thinking: {
      enabled: userConfig.analysisMode !== 'template' && userConfig.thinkingEnabled,
      reasoningEffort: userConfig.reasoningEffort,
    },
  }
}

function resolveVisionSlot(env: NodeJS.ProcessEnv, userConfig: UserConfig): SlotConfig | null {
  const apiKey = configuredValue(env, 'DEEPSEEK_API_KEY', userConfig.provider.apiKey)
  if (!apiKey) return null

  return {
    role: 'vision',
    provider: 'deepseek',
    baseUrl: resolveBaseUrl(env, userConfig),
    apiKey,
    model:
      configuredValue(env, 'DEEPSEEK_VISION_MODEL', userConfig.provider.visionModel) ??
      'deepseek-v4-flash-vision-exp',
    label: 'DeepSeek Vision',
    capabilities: { vision: true, streaming: true, structuredOutput: true },
    temperature: parseTemperature(env, 'DEEPSEEK_VISION_TEMPERATURE') ?? 0.1,
  }
}

export function resolveModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const userConfig = readUserConfig(env)
  const config: ModelConfig = {
    analysisMode: userConfig.analysisMode,
    agent: resolveAgentSlot(env, userConfig),
    vision: resolveVisionSlot(env, userConfig),
    visionDefaults: {
      imageDetail: parseImageDetail(env),
      maxImagesPerCall: parseMaxImages(env),
    },
  }
  validateModelConfig(config)
  return config
}

/** Image-bearing requests must never reach the text-only Agent slot. */
export function validateModelConfig(config: ModelConfig): void {
  if (config.vision && !config.vision.capabilities.vision) {
    throw new Error('[StyleLens] vision slot must have vision capability')
  }
}

export function resolveVisionDispatch(config: ModelConfig): VisionDispatch {
  if (config.analysisMode && config.analysisMode !== 'multimodal') {
    return {
      kind: 'skip',
      reason: `vision disabled by analysis mode: ${config.analysisMode}`,
    }
  }
  if (config.vision) return { kind: 'vision', slot: config.vision }
  if (config.agent.capabilities.vision) return { kind: 'delegate', slot: config.agent }
  return {
    kind: 'skip',
    reason: 'no slot with vision capability; vision evidence downgraded to Unknown',
  }
}

export function createSlotProvider(
  slot: SlotConfig,
  logContext?: ProviderRequestLogContext,
): PromptProvider {
  return slot.provider === 'deepseek'
    ? new DeepSeekProvider(
        slot.apiKey,
        slot.baseUrl,
        slot.model,
        slot.temperature,
        30_000,
        { traceId: logContext?.traceId, slot: slot.role },
        slot.thinking,
      )
    : new MockProvider()
}
