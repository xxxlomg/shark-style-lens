import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'

const VALID_PROFILE = {
  version: '0.1.0',
  target: { uid: 't-1', tagName: 'button' },
  context: {},
  layout: { display: 'inline-flex' },
  typography: { fontSize: '14px' },
  visual: { background: { kind: 'color' } },
  facts: [
    {
      property: 'display',
      value: 'inline-flex',
      source: 'computed',
      confidence: 1,
    },
    {
      property: 'background-color',
      value: '#6366f1',
      source: 'computed',
      confidence: 1,
    },
  ],
  inferences: [
    {
      type: 'component-type',
      conclusion: 'part of a card',
      confidence: 0.8,
      reason: ['x'],
    },
  ],
  warnings: [],
}

describe('POST /api/prompt/stream（§5）', () => {
  const app = createApp()

  beforeEach(() => {
    // These route tests assert the deterministic local MockProvider contract.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

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
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer stylelens-dev',
      },
      body: JSON.stringify({ profile: { target: 'not-an-object' } }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('E_INVALID_PAYLOAD')
  })

  it('streams prompt_start → prompt_chunk → prompt_complete (mock provider)', async () => {
    const res = await app.request('/api/prompt/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer stylelens-dev',
      },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: prompt_start')
    expect(text).toContain('event: prompt_chunk')
    expect(text).toContain('event: prompt_complete')
  })

  it('does not complete a stream after the client aborts', async () => {
    const controller = new AbortController()
    const responsePromise = app.request('/api/prompt/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer stylelens-dev',
      },
      body: JSON.stringify({ profile: VALID_PROFILE }),
      signal: controller.signal,
    })

    const response = await responsePromise
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain(
      'event: prompt_start',
    )

    controller.abort()
    await reader.cancel()
    expect(controller.signal.aborted).toBe(true)
  })

  it('serves the ZIP developer-mode package as an attachment', async () => {
    const res = await app.request('/stylelens.zip', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain(
      'filename="stylelens.zip"',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('does not expose a CRX package', async () => {
    const res = await app.request('/stylelens.crx')
    expect(res.status).toBe(404)
  })

  it('serves a bilingual ZIP-only install page', async () => {
    const res = await app.request('/')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect((html.match(/href="\/stylelens\.zip"/g) ?? []).length).toBe(1)
    expect(html).toContain('data-language="zh"')
    expect(html).toContain('data-language="en"')
    expect(html).toContain('data-i18n="whyNotCrxTitle"')
    expect(html).toContain('Why not CRX?')
    expect(html).not.toContain('href="/stylelens.crx"')
    expect(html).not.toContain('CRX_REQUIRED_PROOF_MISSING')
  })
})
