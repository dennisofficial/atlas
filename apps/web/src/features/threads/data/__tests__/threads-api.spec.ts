import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { setThreadArchived } from '../threads-api'

const realFetch = globalThis.fetch
let calls: { url: string; init: RequestInit | undefined }[] = []

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(null, { status: 204 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('setThreadArchived', () => {
  it('patches the archived route with the flag and resolves on 204', async () => {
    await setThreadArchived({ threadId: 'thr/1', archived: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/v1/threads/thr%2F1/archived')
    expect(calls[0]?.init?.method).toBe('PATCH')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ archived: true }))
  })

  it('rejects when the API answers an error', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Not found' }), { status: 404 })) as typeof fetch
    await expect(setThreadArchived({ threadId: 't1', archived: false })).rejects.toThrow(
      'Not found',
    )
  })
})
