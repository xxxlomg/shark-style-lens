import type { CompiledContext, PromptProvider, ProviderOptions } from './types'

/**
 * Mock Provider：无 DEEPSEEK_API_KEY 时使用。
 * 直接流式输出 Compiler 渲染的 markdown（本地闭环 / e2e 确定性），按句切块。
 */
export class MockProvider implements PromptProvider {
  async *stream(ctx: CompiledContext, _options: ProviderOptions): AsyncIterable<string> {
    const chunks = ctx.markdown.match(/.{1,24}(\s|$)/g) ?? [ctx.markdown]
    for (const chunk of chunks) {
      yield chunk
      await new Promise((r) => setTimeout(r, 1))
    }
  }
}
