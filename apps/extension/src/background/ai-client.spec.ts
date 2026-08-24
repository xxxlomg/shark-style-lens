import { describe, expect, it } from 'vitest'
import { DEFAULT_API_BASE, isLocalApiBase, resolveApiBase } from './ai-client'

describe('local API base URL policy', () => {
  it('accepts loopback hosts and preserves their port', () => {
    expect(isLocalApiBase('http://127.0.0.1:3001')).toBe(true)
    expect(isLocalApiBase('http://localhost:4312')).toBe(true)
    expect(resolveApiBase('http://localhost:4312')).toBe('http://localhost:4312')
  })

  it('rejects remote origins and unsafe URL forms', () => {
    const invalidBases = [
      'https://127.0.0.1:3001',
      'http://192.168.1.10:3001',
      'http://localhost.evil.example:3001',
      'http://user:password@localhost:3001',
      'http://localhost:3001/api',
      'http://localhost:3001?redirect=https://example.com',
      'not-a-url',
    ]

    for (const value of invalidBases) {
      expect(isLocalApiBase(value), value).toBe(false)
      expect(resolveApiBase(value), value).toBe(DEFAULT_API_BASE)
    }
  })

  it('falls back to the fixed loopback endpoint when no value is configured', () => {
    expect(resolveApiBase()).toBe(DEFAULT_API_BASE)
  })
})
