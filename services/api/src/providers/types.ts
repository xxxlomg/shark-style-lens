/** Provider 抽象（§70.1 / §44 AI 层）：模型无关，Extension 与 UI 不感知具体 provider */

export interface CompiledContext {
  /** 渲染成人类可读的 markdown（mock / 调试用） */
  markdown: string
  /** 结构化数据（真实 LLM 的 user 输入） */
  data: unknown
}

export interface ProviderOptions {
  targetFramework?: 'agnostic' | 'react' | 'vue' | 'html-css' | 'tailwind' | 'nextjs'
  language?: 'en'
  detail?: 'compact' | 'balanced' | 'detailed'
}

export interface PromptProvider {
  /** 流式返回 Prompt 增量文本 */
  stream(ctx: CompiledContext, options: ProviderOptions, signal?: AbortSignal): AsyncIterable<string>
}

export class ProviderError extends Error {
  constructor(
    public code:
      | 'E_PROVIDER_AUTH'
      | 'E_PROVIDER_RATE_LIMIT'
      | 'E_PROVIDER_TIMEOUT'
      | 'E_PROVIDER_STREAM_ERROR',
    message: string,
  ) {
    super(message)
  }
}
