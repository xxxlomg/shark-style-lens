import type { CompiledContext, PromptProvider, ProviderOptions } from './types'

/**
 * Mock Provider：未配置 DeepSeek 或 OpenAI Key 时使用。
 * 直接流式输出 Compiler 渲染的 markdown（本地闭环 / e2e 确定性），按句切块。
 */
export class MockProvider implements PromptProvider {
  async *stream(
    ctx: CompiledContext,
    _options: ProviderOptions,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const chunks = ctx.markdown.match(/.{1,24}(\s|$)/g) ?? [ctx.markdown]
    for (const chunk of chunks) {
      if (signal?.aborted) return
      yield chunk
      await new Promise((r) => setTimeout(r, 1))
    }
  }
}
