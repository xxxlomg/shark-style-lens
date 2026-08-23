/**
 * 数据脱敏（§7 / §39 / §65.2）—— 采集层唯一入口，之后任何字段都不得含敏感原文。
 */

const MAX_TEXT = 120

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PHONE_RE = /(\+?\d[\d\s-]{7,}\d)/g
const URL_TOKEN_RE =
  /([?&](?:token|key|secret|auth|api[_-]?key|password|access[_-]?token|signature|code)=)[^&\s]*/gi

/** 文本限长 + 明显 PII 过滤（§7） */
export function sanitizeText(text: string): string {
  let t = text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .replace(URL_TOKEN_RE, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > MAX_TEXT) t = `${t.slice(0, MAX_TEXT)}…`
  return t
}

/** 永不采集的 attribute 名（input value / 密码 / 敏感 aria） */
const NEVER_ATTRS = new Set([
  'value',
  'password',
  'aria-label',
  'aria-valuetext',
  'data-testid', // 可保留，但属实现细节；MVP 保留
])

export function sanitizeAttributes(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (NEVER_ATTRS.has(k)) continue
    if (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret')) continue
    out[k] = sanitizeText(v)
  }
  return out
}

/** 永远不发送的清单（供单测锁定，§65.2） */
export const NEVER_SEND_ATTRS = [...NEVER_ATTRS]
