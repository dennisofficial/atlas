import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { CloudError, DEFAULT_RETRY_MAX_ATTEMPTS } from '../cloud-transport'
import { PrSubscriptionClient } from '../pr-subscription-client'
import { inputOf, trpcFailure, trpcOk } from './trpc-fakes'

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
    globalThis.fetch = (async () => trpcOk(liveSubscribeBody)) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({
      repoFullName: 'dennisofficial/atlas',
      branch: 'dennis/realtime-smoke',
    })

    expect(outcome.id).toBe('sub_1')
    expect(outcome.state?.prNumber).toBe(837)
  })

  it('maps the subscription branch out of the response', async () => {
    globalThis.fetch = (async () =>
      trpcOk({ ...liveSubscribeBody, branch: 'dennis/realtime-smoke' })) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({
      repoFullName: 'dennisofficial/atlas',
      branch: 'dennis/realtime-smoke',
    })

    expect(outcome.branch).toBe('dennis/realtime-smoke')
  })

  it('treats a legacy response with no branch field as branch null', async () => {
    globalThis.fetch = (async () => trpcOk(liveSubscribeBody)) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({
      repoFullName: 'dennisofficial/atlas',
      branch: 'dennis/realtime-smoke',
    })

    expect(outcome.branch).toBeNull()
  })

  it('parses a discovery subscribe response with null prNumber and null state', async () => {
    globalThis.fetch = (async () =>
      trpcOk({
        id: 'sub_9',
        repoFullName: 'dennisofficial/atlas',
        prNumber: null,
        branch: 'dennis/realtime-smoke',
        pollBacked: false,
        expiresAt: '2026-09-28T21:00:00.000Z',
        state: null,
      })) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({
      repoFullName: 'dennisofficial/atlas',
      branch: 'dennis/realtime-smoke',
    })

    expect(outcome.state).toBeNull()
    expect(outcome.branch).toBe('dennis/realtime-smoke')
  })

  it('sends prNumber, not number, when subscribing by number', async () => {
    let seen: unknown
    globalThis.fetch = (async (_url: unknown, init: { body?: unknown }) => {
      seen = inputOf(init)
      return trpcOk({ ...liveSubscribeBody, state: null })
    }) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    await client.subscribe({ repoFullName: 'dennisofficial/atlas', number: 837 })

    expect(seen).toMatchObject({ repoFullName: 'dennisofficial/atlas', prNumber: 837 })
    expect((seen as Record<string, unknown>).number).toBeUndefined()
  })
})

describe('PrSubscriptionClient heartbeat', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('retries a transient 5xx so one blip is invisible to the caller', async () => {
    const statuses = [503, 200]
    let calls = 0
    globalThis.fetch = (async () => {
      const status = statuses[calls++] ?? 200
      return status === 200
        ? trpcOk({ expiresAt: '2026-09-28T21:00:00.000Z' })
        : trpcFailure({ status, message: 'sick' })
    }) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    await client.heartbeat({ id: 'sub_1' })

    expect(calls).toBe(2)
  })

  it('does not retry a terminal 404', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return trpcFailure({ status: 404, message: 'gone' })
    }) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    await expect(client.heartbeat({ id: 'sub_1' })).rejects.toMatchObject({ status: 404 })
    expect(calls).toBe(1)
  })
})

describe('PrSubscriptionClient subscribe retry', () => {
  const realFetch = globalThis.fetch
  const realRandom = Math.random
  const target = { repoFullName: 'dennisofficial/atlas', branch: 'dennis/realtime-smoke' }

  beforeEach(() => {
    Math.random = () => 0
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    Math.random = realRandom
  })

  const subscribeResponse = (): Response => trpcOk(liveSubscribeBody)

  it('retries a network failure and resolves on the next attempt', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return subscribeResponse()
    }) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe(target)

    expect(outcome.id).toBe('sub_1')
    expect(calls).toBe(2)
  })

  it('rejects with CloudError status 0 only after every attempt has failed', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const failure = await client.subscribe(target).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(CloudError)
    expect(failure).toMatchObject({ status: 0 })
    expect(calls).toBe(DEFAULT_RETRY_MAX_ATTEMPTS)
  })

  for (const status of [401, 403]) {
    it(`does not retry a ${status} refusal`, async () => {
      let calls = 0
      globalThis.fetch = (async () => {
        calls += 1
        return trpcFailure({ status, message: 'refused' })
      }) as unknown as typeof fetch

      const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })

      await expect(client.subscribe(target)).rejects.toMatchObject({ status })
      expect(calls).toBe(1)
    })
  }

  it('retries a 500 and resolves when the server recovers', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return trpcFailure({ status: 500, message: 'sick' })
      }
      return subscribeResponse()
    }) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe(target)

    expect(outcome.id).toBe('sub_1')
    expect(calls).toBe(2)
  })

  it('carries the app install recommendation and the poll-backed flag out of the response', async () => {
    globalThis.fetch = (async () =>
      trpcOk({
        ...liveSubscribeBody,
        pollBacked: true,
        recommendAppInstall: {
          installUrl: 'https://github.com/apps/atlas/installations/new',
          repoFullName: 'dennisofficial/atlas',
          extra: 1,
        },
      })) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({ repoFullName: 'dennisofficial/atlas', branch: 'b' })

    expect(outcome.pollBacked).toBe(true)
    expect(outcome.recommendAppInstall).toEqual({
      installUrl: 'https://github.com/apps/atlas/installations/new',
      repoFullName: 'dennisofficial/atlas',
    })
  })

  it('omits the recommendation when the response carries none', async () => {
    globalThis.fetch = (async () => trpcOk(liveSubscribeBody)) as unknown as typeof fetch

    const client = new PrSubscriptionClient({ session: SESSION, clientVersion: 'test' })
    const outcome = await client.subscribe({ repoFullName: 'dennisofficial/atlas', branch: 'b' })

    expect('recommendAppInstall' in outcome).toBe(false)
  })
})
