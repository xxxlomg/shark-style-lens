import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekProvider } from './deepseek'
import { getConfiguredProvider } from './index'
import { OpenAIProvider } from './openai'

const CONTEXT = {
  markdown: '# Prompt',
  data: { observedFacts: ['display: flex'], inferences: [] },
}

function streamingResponse() {
  return new Response(
    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
      'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('provider selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers DeepSeek, then falls back to OpenAI, then mock', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'ds-key')
    vi.stubEnv('OPENAI_API_KEY', 'openai-key')
    expect(getConfiguredProvider().name).toBe('deepseek')

    vi.stubEnv('DEEPSEEK_API_KEY', '')
    expect(getConfiguredProvider().name).toBe('openai')

    vi.stubEnv('OPENAI_API_KEY', '')
    expect(getConfiguredProvider().name).toBe('mock')
  })
})

describe('OpenAI-compatible providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the configured DeepSeek request shape', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.deepseek.com/chat/completions')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.model).toBe('deepseek-v4-flash')
      expect(body.stream).toBe(true)
      expect(body.thinking).toEqual({ type: 'disabled' })
      expect(body.reasoning_effort).toBe('high')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer ds-key')
      return streamingResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const chunks: string[] = []
    for await (const chunk of new DeepSeekProvider('ds-key').stream(CONTEXT, {})) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['hello'])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uses the OpenAI GPT fallback endpoint and model', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/chat/completions')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.model).toBe('gpt-4o-mini')
      expect(body.stream).toBe(true)
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer openai-key')
      return streamingResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const chunks: string[] = []
    for await (const chunk of new OpenAIProvider('openai-key').stream(CONTEXT, {})) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['hello'])
  })

  it('stops reading the upstream stream when the request is aborted', async () => {
    const requestController = new AbortController()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const upstreamSignal = init?.signal as AbortSignal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          upstreamSignal.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const iterator = new OpenAIProvider('openai-key').stream(CONTEXT, {}, requestController.signal)
    const nextChunk = iterator[Symbol.asyncIterator]().next()
    await new Promise((resolve) => setTimeout(resolve, 0))
    requestController.abort()

    await expect(nextChunk).resolves.toMatchObject({ done: true })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
