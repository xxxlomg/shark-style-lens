import { OpenAICompatibleProvider } from './openai-compatible'

/** OpenAI GPT Provider：默认走官方 Chat Completions 地址。 */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(
    apiKey: string,
    baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    firstTokenTimeoutMs = 30_000,
  ) {
    super({ apiKey, baseUrl, model, label: 'OpenAI', firstTokenTimeoutMs })
  }
}
