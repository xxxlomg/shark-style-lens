import { extensionMessageSchema, type ErrorPayload } from '../shared/schemas/messages'

export type RouteResult = { ok: true; type: string } | { ok: false; error: ErrorPayload }

/**
 * MVP 路由骨架：对所有消息做 Zod 校验，非法 payload 返回 E_INVALID_PAYLOAD。
 * Sprint 4 将扩展为 AI 请求编排（ai-client + SSE relay）。
 */
export function handleMessage(message: unknown): RouteResult {
  const parsed = extensionMessageSchema.safeParse(message)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'E_INVALID_PAYLOAD',
        message: 'Message failed Zod validation',
        recoverable: false,
        detail: parsed.error.issues.map((i) => i.path.join('.')).join(', '),
      },
    }
  }
  return { ok: true, type: parsed.data.type }
}
