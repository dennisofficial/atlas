import { describe, expect, it } from 'bun:test'

import {
  CODEX_TURN_STATE_HEADER,
  createCodexTurnStateStore,
  promptCacheKeyOf,
  withCodexTurnState,
} from '../codex-turn-state'

const bodyWith = (key: string): string =>
  JSON.stringify({ model: 'gpt-6.1-sol', prompt_cache_key: key })

const reply = (args: { body?: string | undefined; turnState?: string | undefined } = {}) =>
  Promise.resolve(
    new Response(args.body ?? 'event: done\n\ndata: {}\n\n', {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        ...(args.turnState === undefined ? {} : { [CODEX_TURN_STATE_HEADER]: args.turnState }),
      },
    }),
  )

describe('codex turn state store', () => {
  it('knows nothing before a response arrives', () => {
    const store = createCodexTurnStateStore()
    expect(store.read({ key: 'thread-1' })).toBeUndefined()
  })

  it('returns the latest value written for a key', () => {
    const store = createCodexTurnStateStore()
    store.write({ key: 'thread-1', value: 'ts-1' })
    store.write({ key: 'thread-1', value: 'ts-2' })
    expect(store.read({ key: 'thread-1' })).toBe('ts-2')
  })

  it('forgets a value older than the ttl', () => {
    let at = 1_000
    const store = createCodexTurnStateStore({ ttlMs: 500, now: () => at })
    store.write({ key: 'thread-1', value: 'ts-1' })
    at = 1_500
    expect(store.read({ key: 'thread-1' })).toBe('ts-1')
    at = 1_501
    expect(store.read({ key: 'thread-1' })).toBeUndefined()
  })

  it('evicts the oldest key past the limit', () => {
    const store = createCodexTurnStateStore({ limit: 2 })
    store.write({ key: 'thread-1', value: 'ts-1' })
    store.write({ key: 'thread-2', value: 'ts-2' })
    store.write({ key: 'thread-3', value: 'ts-3' })
    expect(store.size()).toBe(2)
    expect(store.read({ key: 'thread-1' })).toBeUndefined()
    expect(store.read({ key: 'thread-3' })).toBe('ts-3')
  })

  it('clears everything on demand', () => {
    const store = createCodexTurnStateStore()
    store.write({ key: 'thread-1', value: 'ts-1' })
    store.clear()
    expect(store.size()).toBe(0)
    expect(store.read({ key: 'thread-1' })).toBeUndefined()
  })
})

describe('promptCacheKeyOf', () => {
  it('reads the key the provider sends', () => {
    expect(promptCacheKeyOf(bodyWith('thread-1'))).toBe('thread-1')
  })

  it('answers nothing for a body without a key', () => {
    expect(promptCacheKeyOf(JSON.stringify({ model: 'gpt-6.1-sol' }))).toBeUndefined()
    expect(promptCacheKeyOf('not json')).toBeUndefined()
    expect(promptCacheKeyOf(undefined)).toBeUndefined()
  })
})

describe('codex turn state on the wire', () => {
  it('replays a captured turn state on the next request with the same key', async () => {
    const store = createCodexTurnStateStore()
    const seen: Record<string, string>[] = []
    const fetch = withCodexTurnState({
      store,
      fetch: async (_input, init) => {
        const headers: Record<string, string> = {}
        new Headers(init?.headers).forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })
        seen.push(headers)
        return reply({ turnState: seen.length === 1 ? 'ts-1' : undefined })
      },
    })

    await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: bodyWith('thread-1'),
    })
    await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: bodyWith('thread-1'),
    })

    expect(seen[0]?.[CODEX_TURN_STATE_HEADER]).toBeUndefined()
    expect(seen[1]?.[CODEX_TURN_STATE_HEADER]).toBe('ts-1')
  })

  it('keeps a different conversation off another conversation routing', async () => {
    const store = createCodexTurnStateStore()
    const seen: Record<string, string>[] = []
    const fetch = withCodexTurnState({
      store,
      fetch: async (_input, init) => {
        const headers: Record<string, string> = {}
        new Headers(init?.headers).forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })
        seen.push(headers)
        return reply({ turnState: 'ts-1' })
      },
    })

    await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: bodyWith('thread-1'),
    })
    await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      body: bodyWith('thread-2'),
    })

    expect(seen[1]?.[CODEX_TURN_STATE_HEADER]).toBeUndefined()
  })

  it('sends no turn state when the request carries no prompt cache key', async () => {
    const store = createCodexTurnStateStore()
    const seen: Record<string, string>[] = []
    const fetch = withCodexTurnState({
      store,
      fetch: async (_input, init) => {
        const headers: Record<string, string> = {}
        new Headers(init?.headers).forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })
        seen.push(headers)
        return reply({ turnState: 'ts-1' })
      },
    })

    await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', body: '{}' })
    await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', body: '{}' })

    expect(seen.every((headers) => headers[CODEX_TURN_STATE_HEADER] === undefined)).toBe(true)
    expect(store.size()).toBe(0)
  })
})
