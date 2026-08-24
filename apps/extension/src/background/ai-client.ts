import type { StyleProfile } from '../shared/schemas/style-profile'

/** 硬约束：仅本地 localhost 后端（用户确认）；默认值与后端 .env.example 一致 */
export const DEFAULT_API_BASE = 'http://127.0.0.1:3001'
export const DEFAULT_API_SECRET = 'stylelens-dev'
const LOCAL_API_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Resolve a configured API base without ever allowing a remote origin.
 * The manifest also limits host permissions, but this check keeps the request
 * contract local even if chrome.storage is edited outside the settings UI.
 */
export function isLocalApiBase(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      LOCAL_API_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '') &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function resolveApiBase(value?: string): string {
  if (!value || !isLocalApiBase(value)) return DEFAULT_API_BASE
  return new URL(value).origin
}

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

const apiLog = (...args: unknown[]) => console.info('[StyleLens][API]', ...args)
const apiWarn = (...args: unknown[]) => console.warn('[StyleLens][API]', ...args)
const apiError = (...args: unknown[]) => console.error('[StyleLens][API]', ...args)

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
  const controller = activeStreams.get(tabId)
  if (!controller) {
    apiLog('request:cancel:ignored', { tabId, reason: 'no-active-request' })
    return
  }
  activeStreams.delete(tabId)
  controller.abort()
  apiLog('request:cancelled', { tabId })
}

export async function requestPrompt(profile: StyleProfile, tabId: number): Promise<void> {
  const controller = new AbortController()
  activeStreams.set(tabId, controller)
  const traceId = crypto.randomUUID()
  const cleanup = () => {
    if (activeStreams.get(tabId) === controller) activeStreams.delete(tabId)
  }

  const settings = await getSettings()
  const base = resolveApiBase(settings.apiBaseUrl)
  const secret = settings.apiSecret?.trim() || DEFAULT_API_SECRET
  const requestUrl = `${base}/api/prompt/stream`

  const send = (msg: unknown) =>
    chrome.tabs.sendMessage(tabId, msg).catch((error: unknown) => {
      apiWarn('bridge:send-failed', {
        traceId,
        tabId,
        messageType: (msg as { type?: string })?.type,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  const fail = (code: string, message: string, recoverable = true) => {
    const tracedMessage = `${message} [trace: ${traceId}]`
    apiError('request:failed', { traceId, tabId, code, message })
    send({ type: 'ANALYSIS_ERROR', payload: { code, message: tracedMessage, recoverable } })
  }

  apiLog('request:start', {
    traceId,
    tabId,
    method: 'POST',
    url: requestUrl,
    target: profile.target?.tagName,
    factCount: profile.facts?.length ?? 0,
  })
  send({ type: 'PROMPT_START' })

  let resp: Response
  try {
    resp = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        profile,
        options: { targetFramework: 'agnostic', language: 'en', detail: 'balanced' },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) {
      apiLog('request:aborted-before-response', { traceId, tabId })
      cleanup()
      return
    }
    cleanup()
    fail('E_BACKEND_UNAVAILABLE', `Backend unreachable (${requestUrl}): ${(err as Error)?.message}`)
    return
  }

  apiLog('request:response', {
    traceId,
    tabId,
    status: resp.status,
    contentType: resp.headers.get('content-type'),
  })

  if (!resp.ok || !resp.body) {
    if (controller.signal.aborted) {
      cleanup()
      return
    }
    cleanup()
    const errBody = await resp.json().catch(() => null)
    apiError('request:http-error', { traceId, tabId, status: resp.status, body: errBody })
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
  let chunkCount = 0
  let receivedComplete = false

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
          chunkCount += 1
          send({ type: 'PROMPT_CHUNK', payload: { text: evt.data.text } })
        } else if (evt.event === 'prompt_complete') {
          receivedComplete = true
          apiLog('stream:complete', { traceId, tabId, chunkCount })
          send({ type: 'PROMPT_COMPLETE' })
          cleanup()
          return
        } else if (evt.event === 'prompt_error') {
          apiError('stream:provider-error', {
            traceId,
            tabId,
            code: evt.data.code,
            message: evt.data.message,
          })
          fail(evt.data.code ?? 'E_PROVIDER_STREAM_ERROR', evt.data.message ?? 'Provider error')
          cleanup()
          return
        }
      }
    }
    if (!receivedComplete) {
      apiWarn('stream:closed-without-complete', { traceId, tabId, chunkCount })
      fail('E_SSE_DISCONNECT', 'Local API stream closed before completion')
    }
  } catch (err) {
    if (controller.signal.aborted) {
      // 用户主动取消（Re-select / Esc）—— 静默，不发错误
      apiLog('stream:aborted', { traceId, tabId, chunkCount })
      cleanup()
      return
    }
    apiError('stream:read-failed', {
      traceId,
      tabId,
      chunkCount,
      error: err instanceof Error ? err.message : String(err),
    })
    fail('E_SSE_DISCONNECT', `Stream disconnected: ${(err as Error)?.message}`)
  }
  cleanup()
}
