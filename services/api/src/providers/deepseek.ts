import { OpenAICompatibleProvider } from './openai-compatible'

/** DeepSeek Provider：使用 DeepSeek Chat Completions + SSE 流式输出。 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(
    apiKey: string,
    baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    firstTokenTimeoutMs = 30_000,
  ) {
    super({
      apiKey,
      baseUrl,
      model,
      label: 'DeepSeek',
      firstTokenTimeoutMs,
      extraBody: {
        thinking: { type: 'disabled' },
        reasoning_effort: 'high',
      },
    })
  }
}
