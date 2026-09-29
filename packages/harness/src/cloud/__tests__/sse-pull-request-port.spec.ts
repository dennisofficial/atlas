import { afterEach, describe, expect, it } from 'bun:test'

import { EPullRequestLookup, EForge, type RepositoryCheckout } from '../../plugins/github/pure'
import { SsePullRequestPort } from '../sse-pull-requests'
import type { SubscriptionPrState } from '../pr-subscription-client'

const SESSION = { url: 'https://api.test', token: 'tok', email: null }

const liveSubscribeBody = {
  id: 'sub_1',
  repoFullName: 'owner/repo',
  prNumber: 42,
  pollBacked: false,
  expiresAt: '2026-09-29T21:00:00.000Z',
  state: {
    repoFullName: 'owner/repo',
    prNumber: 42,
    title: 'smoke',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    headBranch: 'feature',
    headSha: 'abc',
    checksRunning: 7,
    checksPassed: 2,
    checksFailed: 0,
    mergeable: null,
    updatedAt: '2026-09-29T20:00:00.000Z',
  },
}

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}

const respond = (body: unknown, status = 201): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('SsePullRequestPort recovery', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('re-probes after a refused session instead of holding the stale reading', async () => {
    const bodies: unknown[] = []
    let subscribes = 0
    let streamAttempts = 0

    globalThis.fetch = (async (url: unknown, init: { body?: string } = {}) => {
      const target = String(url)
      if (target.endsWith('/v1/github/subscriptions')) {
        subscribes += 1
        bodies.push(JSON.parse(init.body ?? '{}'))
        return respond(liveSubscribeBody)
      }
      if (target.endsWith('/v1/github/prs/stream')) {
        streamAttempts += 1
        if (streamAttempts === 1) return new Response(null, { status: 401 })
        // Never resolve: a healthy stream stays open, so the test cannot exit past it.
        return new Promise<Response>(() => {})
      }
      return respond({})
    }) as unknown as typeof fetch

    const readings: { lookup: EPullRequestLookup; retryable?: boolean }[] = []
    const port = new SsePullRequestPort({
      session: SESSION,
      clientVersion: 'test',
      onReading: ({ reading }) => readings.push(reading),
      clock: { now: () => 0 },
    })

    await port.read({ checkout: CHECKOUT })
    // Let the stream's 401 land (it resolves asynchronously out of ensureStream), so the port
    // knows the session is dead before the next read — the real gap between turns.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await port.read({ checkout: CHECKOUT })

    expect(subscribes).toBe(2)
    expect(streamAttempts).toBe(2)
    const last = readings[readings.length - 1]
    expect(last?.lookup).toBe(EPullRequestLookup.Found)
    expect(bodies[1]).toMatchObject({ repoFullName: 'owner/repo', branch: 'feature' })
  }, 10_000)

  it('keeps the held reading retryable while a refused session is dead, so the tally does not freeze', async () => {
    let streamAttempts = 0
    globalThis.fetch = (async (url: unknown) => {
      const target = String(url)
      if (target.endsWith('/v1/github/subscriptions')) return respond(liveSubscribeBody)
      if (target.endsWith('/v1/github/prs/stream')) {
        streamAttempts += 1
        return new Response(null, { status: 403 })
      }
      return respond({})
    }) as unknown as typeof fetch

    const readings: { lookup: EPullRequestLookup; retryable?: boolean }[] = []
    const port = new SsePullRequestPort({
      session: SESSION,
      clientVersion: 'test',
      onReading: ({ reading }) => readings.push(reading),
      clock: { now: () => 0 },
    })

    await port.read({ checkout: CHECKOUT })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const last = readings[readings.length - 1]
    expect(last?.lookup).toBe(EPullRequestLookup.Unavailable)
    expect(last?.retryable).toBe(true)
  }, 10_000)
})
