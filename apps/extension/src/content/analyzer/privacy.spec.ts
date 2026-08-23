import { describe, expect, it } from 'vitest'
import { NEVER_SEND_ATTRS, sanitizeAttributes, sanitizeText } from './privacy'

describe('sanitizeText（§7 / §39）', () => {
  it('redacts emails and phone numbers', () => {
    expect(sanitizeText('contact me at user@example.com or 138-0013-8000')).toBe(
      'contact me at [email] or [phone]',
    )
  })

  it('redacts url tokens', () => {
    expect(sanitizeText('open https://a.com/p?token=abc123&x=1')).toBe(
      'open https://a.com/p?token=[redacted]&x=1',
    )
  })

  it('truncates long text to 120 chars + ellipsis', () => {
    const long = 'x'.repeat(300)
    expect(sanitizeText(long).length).toBe(121)
  })

  it('normalizes whitespace', () => {
    expect(sanitizeText('  a   b  ')).toBe('a b')
  })
})

describe('sanitizeAttributes', () => {
  it('strips value / password / token-like keys', () => {
    const out = sanitizeAttributes({
      value: 'secret',
      'data-secret-token': 's',
      'aria-label': 'x',
      id: 'btn-1',
    })
    expect(out).toEqual({ id: 'btn-1' })
  })

  it('never-send list is explicit for tests', () => {
    expect(NEVER_SEND_ATTRS).toContain('value')
  })
})
