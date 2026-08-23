import { describe, expect, it } from 'vitest'
import { createApp } from '../app'

const VALID_PROFILE = {
  version: '0.1.0',
  target: { uid: 't-1', tagName: 'button' },
  context: {},
  layout: { display: 'inline-flex' },
  typography: { fontSize: '14px' },
  visual: { background: { kind: 'color' } },
  facts: [
    { property: 'display', value: 'inline-flex', source: 'computed', confidence: 1 },
    { property: 'background-color', value: '#6366f1', source: 'computed', confidence: 1 },
  ],
  inferences: [
    { type: 'component-type', conclusion: 'part of a card', confidence: 0.8, reason: ['x'] },
  ],
  warnings: [],
}

describe('POST /api/prompt/stream（§5）', () => {
  const app = createApp()

  it('401 without shared secret', async () => {
    const res = await app.request('/api/prompt/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    })
    expect(res.status).toBe(401)
  })

  it('400 on invalid payload (with valid secret)', async () => {
    const res = await app.request('/api/prompt/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer stylelens-dev' },
      body: JSON.stringify({ profile: { target: 'not-an-object' } }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('E_INVALID_PAYLOAD')
  })

  it('streams prompt_start → prompt_chunk → prompt_complete (mock provider)', async () => {
    const res = await app.request('/api/prompt/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer stylelens-dev' },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: prompt_start')
    expect(text).toContain('event: prompt_chunk')
    expect(text).toContain('event: prompt_complete')
  })
})
