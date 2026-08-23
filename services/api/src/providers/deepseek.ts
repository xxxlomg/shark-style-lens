import { ProviderError, type CompiledContext, type PromptProvider, type ProviderOptions } from './types'

/** DeepSeek Provider：OpenAI 兼容 chat/completions + SSE 流式（默认模型 deepseek-chat） */
export class DeepSeekProvider implements PromptProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    private readonly model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    private readonly firstTokenTimeoutMs = 30_000,
  ) {}

  async *stream(ctx: CompiledContext, options: ProviderOptions): AsyncIterable<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          temperature: 0.3,
          max_tokens: 2048,
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: JSON.stringify(ctx.data),
            },
          ],
        }),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if ((err as Error)?.name === 'AbortError') {
        throw new ProviderError('E_PROVIDER_TIMEOUT', 'DeepSeek request timed out')
      }
      throw new ProviderError('E_PROVIDER_STREAM_ERROR', `DeepSeek request failed: ${(err as Error)?.message}`)
    }
    clearTimeout(timeout)

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('E_PROVIDER_AUTH', 'Invalid DeepSeek API key (check server env)')
    }
    if (response.status === 429) {
      throw new ProviderError('E_PROVIDER_RATE_LIMIT', 'DeepSeek rate limit exceeded')
    }
    if (!response.ok || !response.body) {
      throw new ProviderError('E_PROVIDER_STREAM_ERROR', `DeepSeek responded ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let first = true

    while (true) {
      const read = reader.read()
      let result: ReadableStreamReadResult<Uint8Array>
      if (first) {
        // 首 token 超时（§4.2 验收）
        result = await Promise.race([
          read,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new ProviderError('E_PROVIDER_TIMEOUT', 'First token timeout')),
              this.firstTokenTimeoutMs,
            ),
          ),
        ])
        first = false
      } else {
        result = await read
      }
      const { done, value } = result
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch {
          /* 忽略无法解析的帧 */
        }
      }
    }
  }
}

const SYSTEM_PROMPT = `You are a UI reverse-engineering assistant.
Given structured analysis of a web UI component, produce a detailed, framework-agnostic prompt that another AI coding tool can use to recreate the component with high visual fidelity.

Rules:
- Prioritize visual fidelity over source-code similarity.
- Do not attempt to reproduce the original frontend framework or component library.
- Follow the exact section structure requested.
- Never invent facts absent from the analysis; clearly mark inferences.
- Describe visual hierarchy, spacing, proportions, typography, color, surface treatment, layout behavior, responsive intent and component relationships.`
