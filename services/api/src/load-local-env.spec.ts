import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEnvValues } from './load-local-env'

describe('local env loading', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lets an explicit empty .env value disable an inherited provider key', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'stale-deepseek-key')
    vi.stubEnv('OPENAI_API_KEY', 'configured-openai-key')

    applyEnvValues({
      DEEPSEEK_API_KEY: '',
      OPENAI_API_KEY: 'configured-openai-key',
    })

    expect(process.env.DEEPSEEK_API_KEY).toBe('')
    expect(process.env.OPENAI_API_KEY).toBe('configured-openai-key')
  })
})
