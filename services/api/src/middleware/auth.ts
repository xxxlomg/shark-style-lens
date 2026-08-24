import type { MiddlewareHandler } from 'hono'

/** 本地开发缺省密钥（与扩展默认设置一致）；生产通过 env STYLELENS_API_SECRET 覆盖 */
const DEFAULT_SECRET = 'stylelens-dev'

/** 共享密钥鉴权（MESSAGE_PROTOCOL §5.2）：`Authorization: Bearer <secret>` */
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env.STYLELENS_API_SECRET ?? DEFAULT_SECRET
    const traceId = c.req.header('x-trace-id')?.trim() || 'missing'
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token || token !== expected) {
      console.warn('[StyleLens API] auth:rejected', {
        traceId,
        path: new URL(c.req.url).pathname,
        reason: token ? 'secret-mismatch' : 'missing-token',
      })
      return c.json(
        { error: { code: 'E_AUTH_FAILED', message: 'Invalid shared secret' } },
        401,
      )
    }
    console.info('[StyleLens API] auth:accepted', { traceId })
    await next()
  }
}
