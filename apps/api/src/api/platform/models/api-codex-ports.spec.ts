import { describe, expect, it } from 'bun:test'
import { CodexCacheRegistry, sha256Identity } from './api-codex-ports'

describe('CodexCacheRegistry', () => {
  it('keeps one cache per user', async () => {
    const registry = new CodexCacheRegistry()
    await registry.cacheFor('u1').write('one')

    expect(registry.cacheFor('u1').read()).toBe('one')
    expect(registry.cacheFor('u2').read()).toBeUndefined()
  })

  it('evicts the least recently used user beyond its cap', async () => {
    const registry = new CodexCacheRegistry(2)
    await registry.cacheFor('u1').write('1')
    await registry.cacheFor('u2').write('2')
    registry.cacheFor('u1').read()
    await registry.cacheFor('u3').write('3')

    expect(registry.cacheFor('u1').read()).toBe('1')
    expect(registry.cacheFor('u2').read()).toBeUndefined()
    expect(registry.cacheFor('u3').read()).toBe('3')
  })
})

describe('sha256Identity', () => {
  it('hashes the ChatGPT account id, falling back to the connection id', () => {
    const one = sha256Identity({ accountId: 'c1', providerAccountId: 'a' })
    expect(one).toMatch(/^[0-9a-f]{64}$/)
    expect(one).not.toBe(sha256Identity({ accountId: 'c1' }))
  })
})
