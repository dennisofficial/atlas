import { afterEach, describe, expect, it } from 'bun:test'

import { PrSubscriptionClient } from '../pr-subscription-client'

const SESSION = { url: 'https://api.test', token: 'tok', email: null }

const liveSubscribeBody = {
  id: 'sub_1',
  repoFullName: 'dennisofficial/atlas',
  prNumber: 837,
  pollBacked: false,
  expiresAt: '2026-09-28T21:00:00.000Z',
  state: {
    repoFullName: 'dennisofficial/atlas',
    prNumber: 837,
    title: 'smoke',
    url: 'https://github.com/dennisofficial/atlas/pull/837',
    state: 'draft',
    headBranch: 'dennis/realtime-smoke',
    headSha: 'abc',
    checksRunning: 8,
    checksPassed: 1,
    checksFailed: 0,
    mergeable: null,
    updatedAt: '2026-09-28T20:00:00.000Z',
  },
}

describe('PrSubscriptionClient', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('parses a subscribe response that carries fields the client does not read', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(liveSubscribeBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({ repoFullName: 'dennisofficial/atlas', branch: 'dennis/realtime-smoke' })

    expect(outcome.id).toBe('sub_1')
    expect(outcome.state?.prNumber).toBe(837)
  })

  it('sends prNumber, not number, when subscribing by number', async () => {
    let seen: unknown
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      seen = JSON.parse(init.body ?? '{}')
      return new Response(JSON.stringify({ ...liveSubscribeBody, state: null }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    await client.subscribe({ repoFullName: 'dennisofficial/atlas', number: 837 })

    expect(seen).toMatchObject({ repoFullName: 'dennisofficial/atlas', prNumber: 837 })
    expect((seen as Record<string, unknown>).number).toBeUndefined()
  })
})
