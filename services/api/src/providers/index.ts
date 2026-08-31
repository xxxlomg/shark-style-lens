import {
  createSlotProvider,
  resolveModelConfig,
  resolveVisionDispatch,
  type ModelConfig,
  type ProviderKind,
  type ProviderRequestLogContext,
  type SlotConfig,
  type VisionDispatch,
} from './model-config'
import type { PromptProvider } from './types'

export type ProviderName = ProviderKind

export interface ConfiguredProvider {
  name: ProviderName
  provider: PromptProvider
  slot: SlotConfig
}

export type { ModelConfig, ProviderKind, ProviderRequestLogContext, SlotConfig, VisionDispatch }

/** §45 Dual-Slot Model Config Registry：从服务端 env 解析双槽位配置（含启动期不变量校验） */
export function getModelConfig(): ModelConfig {
  return resolveModelConfig()
}

/** §45.5 视觉调度决策：专用视觉槽 → 委托多模态 Agent 槽 → 跳过 */
export function getVisionDispatch(): VisionDispatch {
  return resolveVisionDispatch(getModelConfig())
}

/** Agent 槽 Provider（综合推理），保持既有单槽位调用方的向后兼容 */
export function getConfiguredProvider(
  logContext?: ProviderRequestLogContext,
): ConfiguredProvider {
  const slot = getModelConfig().agent
  return { name: slot.provider, provider: createSlotProvider(slot, logContext), slot }
}

export function getProvider(): PromptProvider {
  return getConfiguredProvider().provider
}

export function getProviderName(): ProviderName {
  return getConfiguredProvider().name
}
