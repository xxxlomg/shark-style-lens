import { Hono } from 'hono'
import { compilePromptContext } from '../compiler/prompt-compiler'
import type { LightProfile } from '../compiler/types'
import { authMiddleware } from '../middleware/auth'
import { getConfiguredProvider } from '../providers'
import { ProviderError } from '../providers/types'
import { promptStreamRequestSchema } from '../schemas'

export const promptStreamRoute = new Hono()

promptStreamRoute.post('/stream', authMiddleware(), async (c) => {
  const traceId = c.req.header('x-trace-id')?.trim() || crypto.randomUUID()
  const startedAt = Date.now()
  console.info('[StyleLens API] prompt:received', {
    traceId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  })

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    console.warn('[StyleLens API] prompt:invalid-json', { traceId })
    return c.json(
      {
        error: {
          code: 'E_INVALID_PAYLOAD',
          message: 'Request body must be JSON',
        },
      },
      400,
    )
  }

  const parsed = promptStreamRequestSchema.safeParse(body)
  if (!parsed.success) {
    console.warn('[StyleLens API] prompt:invalid-payload', {
      traceId,
      detail: parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    })
    return c.json(
      {
        error: {
          code: 'E_INVALID_PAYLOAD',
          message: 'Request body failed validation',
          detail: parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        },
      },
      400,
    )
  }

  const { profile, options } = parsed.data
  const compiled = compilePromptContext(
    profile as unknown as LightProfile,
    options ?? {},
  )
  const configured = getConfiguredProvider()
  const provider = configured.provider
  const requestSignal = c.req.raw.signal

  console.info('[StyleLens API] prompt:provider-selected', {
    traceId,
    provider: configured.name,
    target: profile.target.tagName,
    factCount: profile.facts.length,
  })

  c.header('content-type', 'text/event-stream')
  c.header('cache-control', 'no-cache')
  c.header('connection', 'keep-alive')

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          )
        } catch {
          /* 客户端已断开 */
        }
      }
      const ping = setInterval(() => send('ping', {}), 15_000)

      if (requestSignal.aborted) {
        console.info('[StyleLens API] prompt:aborted-before-stream', {
          traceId,
        })
        clearInterval(ping)
        try {
          controller.close()
        } catch {
          /* 客户端已断开 */
        }
        return
      }

      send('prompt_start', {})
      console.info('[StyleLens API] prompt:upstream-start', {
        traceId,
        provider: configured.name,
      })
      try {
        for await (const chunk of provider.stream(
          compiled,
          options ?? {},
          requestSignal,
        )) {
          send('prompt_chunk', { text: chunk })
        }
        if (!requestSignal.aborted) {
          send('prompt_complete', { promptId: crypto.randomUUID() })
          console.info('[StyleLens API] prompt:complete', {
            traceId,
            provider: configured.name,
            durationMs: Date.now() - startedAt,
          })
        }
      } catch (err) {
        if (!requestSignal.aborted) {
          const code =
            err instanceof ProviderError ? err.code : 'E_PROVIDER_STREAM_ERROR'
          console.error('[StyleLens API] prompt:error', {
            traceId,
            provider: configured.name,
            code,
            message: (err as Error)?.message ?? 'Stream failed',
            durationMs: Date.now() - startedAt,
          })
          send('prompt_error', {
            code,
            message: (err as Error)?.message ?? 'Stream failed',
            recoverable: true,
          })
        }
      } finally {
        if (requestSignal.aborted) {
          console.info('[StyleLens API] prompt:aborted', {
            traceId,
            provider: configured.name,
            durationMs: Date.now() - startedAt,
          })
        }
        clearInterval(ping)
        try {
          controller.close()
        } catch {
          /* 客户端已断开 */
        }
      }
    },
  })

  return c.body(stream)
})
