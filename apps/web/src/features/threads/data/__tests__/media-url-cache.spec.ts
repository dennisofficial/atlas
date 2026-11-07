import { describe, expect, it } from 'bun:test'

import { createMediaUrlCache } from '../media-url-cache'

const key = { sessionId: 's', hash: 'h' }

describe('createMediaUrlCache', () => {
  it('fetches once per key within the ttl', async () => {
    let fetched = 0
    let clock = 0
    const cache = createMediaUrlCache({
      fetch: async () => `url-${++fetched}`,
      now: () => clock,
      ttlMs: 100,
    })
    expect(await cache.urlOf(key)).toBe('url-1')
    clock = 99
    expect(await cache.urlOf(key)).toBe('url-1')
    clock = 100
    expect(await cache.urlOf(key)).toBe('url-2')
  })

  it('keys by session as well as hash', async () => {
    let fetched = 0
    const cache = createMediaUrlCache({
      fetch: async () => `url-${++fetched}`,
    })
    await cache.urlOf(key)
    expect(await cache.urlOf({ sessionId: 't', hash: 'h' })).toBe('url-2')
  })

  it('forgets a failed fetch so the next call retries', async () => {
    let fetched = 0
    const cache = createMediaUrlCache({
      fetch: async () => {
        fetched += 1
        if (fetched === 1) throw new Error('boom')
        return 'ok'
      },
    })
    await expect(cache.urlOf(key)).rejects.toThrow('boom')
    await Promise.resolve()
    expect(await cache.urlOf(key)).toBe('ok')
  })
})
