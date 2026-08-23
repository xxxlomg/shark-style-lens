import { DeepSeekProvider } from './deepseek'
import { MockProvider } from './mock'
import type { PromptProvider } from './types'

/** Provider 注册表：有 DEEPSEEK_API_KEY → deepseek；否则 mock（本地闭环 / e2e） */
export function getProvider(): PromptProvider {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (apiKey) return new DeepSeekProvider(apiKey)
  return new MockProvider()
}
