import { DeepSeekProvider } from './deepseek'
import { MockProvider } from './mock'
import { OpenAIProvider } from './openai'
import type { PromptProvider } from './types'

export type ProviderName = 'deepseek' | 'openai' | 'mock'

export interface ConfiguredProvider {
  name: ProviderName
  provider: PromptProvider
}

/** Provider 优先级：DeepSeek → OpenAI GPT → Mock。只按 Key 是否配置选择。 */
export function getConfiguredProvider(): ConfiguredProvider {
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (deepseekKey) return { name: 'deepseek', provider: new DeepSeekProvider(deepseekKey) }

  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  if (openaiKey) return { name: 'openai', provider: new OpenAIProvider(openaiKey) }

  return { name: 'mock', provider: new MockProvider() }
}

export function getProvider(): PromptProvider {
  return getConfiguredProvider().provider
}

export function getProviderName(): ProviderName {
  return getConfiguredProvider().name
}
