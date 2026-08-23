import type { StyleProfile } from '../shared/schemas/style-profile'

/** 硬约束：仅本地 localhost 后端（用户确认）；默认值与后端 .env.example 一致 */
export const DEFAULT_API_BASE = 'http://127.0.0.1:3001'
export const DEFAULT_API_SECRET = 'stylelens-dev'

interface Settings {
  apiBaseUrl?: string
  apiSecret?: string
}

async function getSettings(): Promise<Settings> {
  try {
    const res = await chrome.storage.local.get('stylelens.settings')
    return (res['stylelens.settings'] as Settings | undefined) ?? {}
  } catch {
    return {}
  }
}

interface SseEvent {
  event: string
  data: { text?: string; code?: string; message?: string; recoverable?: boolean }
}

function parseSseEvent(raw: string): SseEvent | null {
  const lines = raw.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as SseEvent['data'] }
  } catch {
    return { event, data: { text: dataLines.join('\n') } }
  }
}

/**
 * Background → services/api 流式编排（MESSAGE_PROTOCOL §5 / §36）：
 * POST /api/prompt/stream → SSE 消费 → PROMPT_CHUNK 转发到目标 tab。
 * 支持按 tab 中止（PROMPT_CANCEL，Re-select / 取消时调用）。
 */
const activeStreams = new Map<number, AbortController>()

export function cancelPrompt(tabId: number) {
  activeStreams.get(tabId)?.abort()
}

export async function requestPrompt(profile: StyleProfile, tabId: number): Promise<void> {
  const controller = new AbortController()
  activeStreams.set(tabId, controller)
  const cleanup = () => {
    if (activeStreams.get(tabId) === controller) activeStreams.delete(tabId)
  }

  const settings = await getSettings()
  const base = settings.apiBaseUrl ?? DEFAULT_API_BASE
  const secret = settings.apiSecret ?? DEFAULT_API_SECRET

  const send = (msg: unknown) => chrome.tabs.sendMessage(tabId, msg).catch(() => {})
  const fail = (code: string, message: string, recoverable = true) =>
    send({ type: 'ANALYSIS_ERROR', payload: { code, message, recoverable } })

  send({ type: 'PROMPT_START' })

  let resp: Response
  try {
    resp = await fetch(`${base}/api/prompt/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        profile,
        options: { targetFramework: 'agnostic', language: 'en', detail: 'balanced' },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) {
      cleanup()
      return
    }
    cleanup()
    fail('E_BACKEND_UNAVAILABLE', `Backend unreachable (${base}): ${(err as Error)?.message}`)
    return
  }

  if (!resp.ok || !resp.body) {
    if (controller.signal.aborted) {
      cleanup()
      return
    }
    cleanup()
    const errBody = await resp.json().catch(() => null)
    fail(
      (errBody as { error?: { code?: string } })?.error?.code ?? 'E_BACKEND_UNAVAILABLE',
      (errBody as { error?: { message?: string } })?.error?.message ??
        `Backend responded ${resp.status}`,
    )
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const evt = parseSseEvent(frame)
        if (!evt) continue
        if (evt.event === 'prompt_chunk' && evt.data.text) {
          send({ type: 'PROMPT_CHUNK', payload: { text: evt.data.text } })
        } else if (evt.event === 'prompt_complete') {
          send({ type: 'PROMPT_COMPLETE' })
          cleanup()
          return
        } else if (evt.event === 'prompt_error') {
          fail(evt.data.code ?? 'E_PROVIDER_STREAM_ERROR', evt.data.message ?? 'Provider error')
          cleanup()
          return
        }
      }
    }
    send({ type: 'PROMPT_COMPLETE' })
  } catch (err) {
    if (controller.signal.aborted) {
      // 用户主动取消（Re-select / Esc）—— 静默，不发错误
      cleanup()
      return
    }
    fail('E_SSE_DISCONNECT', `Stream disconnected: ${(err as Error)?.message}`)
  }
  cleanup()
}
