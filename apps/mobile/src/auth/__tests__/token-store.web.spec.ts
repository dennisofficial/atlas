import { describe, expect, it } from 'bun:test'

import { createTokenStore, pendingAuthStorage } from '../token-store.web'

const createMemoryStorage = () => {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
}

describe('web token store', () => {
  it('loads nothing when empty', async () => {
    const store = createTokenStore(createMemoryStorage())
    expect(await store.load()).toBeUndefined()
  })

  it('round-trips a token', async () => {
    const store = createTokenStore(createMemoryStorage())
    await store.save('bearer-1')
    expect(await store.load()).toBe('bearer-1')
  })

  it('clears the token', async () => {
    const storage = createMemoryStorage()
    const store = createTokenStore(storage)
    await store.save('bearer-1')
    await store.clear()
    expect(await store.load()).toBeUndefined()
    expect(storage.getItem('atlas.bearer')).toBeNull()
  })
})

describe('pending auth storage', () => {
  it('round-trips and clears the pending payload', () => {
    const storage = pendingAuthStorage(createMemoryStorage())
    expect(storage.load()).toBeUndefined()
    storage.save('{"verifier":"v"}')
    expect(storage.load()).toBe('{"verifier":"v"}')
    storage.clear()
    expect(storage.load()).toBeUndefined()
  })
})
