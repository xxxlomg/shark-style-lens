import { Hono } from 'hono'
import { compilePromptContext } from '../compiler/prompt-compiler'
import { authMiddleware } from '../middleware/auth'
import { getProvider } from '../providers'
import { ProviderError } from '../providers/types'
import { promptStreamRequestSchema } from '../schemas'

export const promptStreamRoute = new Hono()

promptStreamRoute.post('/stream', authMiddleware(), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: { code: 'E_INVALID_PAYLOAD', message: 'Request body must be JSON' } },
      400,
    )
  }

  const parsed = promptStreamRequestSchema.safeParse(body)
  if (!parsed.success) {
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
  const compiled = compilePromptContext(profile, options)
  const provider = getProvider()

  c.header('content-type', 'text/event-stream')
  c.header('cache-control', 'no-cache')
  c.header('connection', 'keep-alive')

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* 客户端已断开 */
        }
      }
      const ping = setInterval(() => send('ping', {}), 15_000)

      send('prompt_start', {})
      try {
        for await (const chunk of provider.stream(compiled, options)) {
          send('prompt_chunk', { text: chunk })
        }
        send('prompt_complete', { promptId: crypto.randomUUID() })
      } catch (err) {
        const code =
          err instanceof ProviderError ? err.code : 'E_PROVIDER_STREAM_ERROR'
        send('prompt_error', { code, message: (err as Error)?.message ?? 'Stream failed', recoverable: true })
      } finally {
        clearInterval(ping)
        controller.close()
      }
    },
  })

  return c.body(stream)
})
