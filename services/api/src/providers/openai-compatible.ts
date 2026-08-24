import { ProviderError, type CompiledContext, type PromptProvider, type ProviderOptions } from './types'
import { SYSTEM_PROMPT } from './system-prompt'

interface OpenAICompatibleConfig {
  apiKey: string
  baseUrl: string
  model: string
  label: string
  firstTokenTimeoutMs?: number
  extraBody?: Record<string, unknown>
}

/** Shared streaming implementation for providers exposing Chat Completions. */
export class OpenAICompatibleProvider implements PromptProvider {
  private readonly firstTokenTimeoutMs: number

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.firstTokenTimeoutMs = config.firstTokenTimeoutMs ?? 30_000
  }

  async *stream(
    ctx: CompiledContext,
    _options: ProviderOptions,
    requestSignal?: AbortSignal,
  ): AsyncIterable<string> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 120_000)
    const abortFromRequest = () => controller.abort()
    if (requestSignal?.aborted) return
    requestSignal?.addEventListener('abort', abortFromRequest, { once: true })
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '')
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(ctx.data) },
          ],
          ...this.config.extraBody,
          // The local API relays provider output over SSE to the extension.
          stream: true,
        }),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      requestSignal?.removeEventListener('abort', abortFromRequest)
      if (requestSignal?.aborted) return
      if ((err as Error)?.name === 'AbortError') {
        throw new ProviderError('E_PROVIDER_TIMEOUT', `${this.config.label} request timed out`)
      }
      throw new ProviderError(
        'E_PROVIDER_STREAM_ERROR',
        `${this.config.label} request failed: ${(err as Error)?.message}`,
      )
    }
    try {
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          'E_PROVIDER_AUTH',
          `Invalid ${this.config.label} API key (check server env)`,
        )
      }
      if (response.status === 429) {
        throw new ProviderError('E_PROVIDER_RATE_LIMIT', `${this.config.label} rate limit exceeded`)
      }
      if (!response.ok || !response.body) {
        throw new ProviderError(
          'E_PROVIDER_STREAM_ERROR',
          `${this.config.label} responded ${response.status}`,
        )
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let first = true

      while (true) {
        if (requestSignal?.aborted) return
        const read = reader.read()
        let result: ReadableStreamReadResult<Uint8Array>
        if (first) {
          result = await Promise.race([
            read,
            new Promise<never>((_, reject) => {
              firstTokenTimer = setTimeout(() => {
                timedOut = true
                controller.abort()
                reject(new ProviderError('E_PROVIDER_TIMEOUT', 'First token timeout'))
              }, this.firstTokenTimeoutMs)
            }),
          ])
          clearTimeout(firstTokenTimer)
          firstTokenTimer = undefined
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
            // Ignore malformed provider frames and continue the stream.
          }
        }
      }
    } catch (err) {
      if (requestSignal?.aborted) return
      if (err instanceof ProviderError) throw err
      if (timedOut || (err as Error)?.name === 'AbortError') {
        throw new ProviderError('E_PROVIDER_TIMEOUT', `${this.config.label} request timed out`)
      }
      throw new ProviderError(
        'E_PROVIDER_STREAM_ERROR',
        `${this.config.label} stream failed: ${(err as Error)?.message}`,
      )
    } finally {
      clearTimeout(timeout)
      clearTimeout(firstTokenTimer)
      requestSignal?.removeEventListener('abort', abortFromRequest)
    }
  }
}
