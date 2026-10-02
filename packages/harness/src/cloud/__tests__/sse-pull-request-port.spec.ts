import { afterEach, describe, expect, it } from 'bun:test'

import { ELogSeverity, type LogEntry, type LogPort } from '@dltech/atlas-core'

import { EPullRequestLookup, EForge, type RepositoryCheckout } from '../../plugins/github/pure'
import { SsePullRequestPort } from '../sse-pull-requests'
import type { SubscriptionPrState } from '../pr-subscription-client'

const SESSION = { url: 'https://api.test', token: 'tok', email: null }
const ports: SsePullRequestPort[] = []
const createPort = (args: ConstructorParameters<typeof SsePullRequestPort>[0]): SsePullRequestPort => {
  const port = new SsePullRequestPort(args)
  ports.push(port)
  return port
}

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

describe('SsePullRequestPort discovery', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    for (const port of ports.splice(0)) port.dispose()
    globalThis.fetch = realFetch
  })

  it('holds an Absent entry from a state-null subscribe and answers repeats from the book', async () => {
    let subscribes = 0
    let streamAttempts = 0
    globalThis.fetch = (async (url: unknown, init: { body?: string } = {}) => {
      const target = String(url)
      if (target.endsWith('/v1/github/subscriptions')) {
        subscribes += 1
        return respond({
          id: 'sub_1',
          repoFullName: 'owner/repo',
          prNumber: null,
          branch: 'feature',
          pollBacked: false,
          expiresAt: '2026-09-29T21:00:00.000Z',
          state: null,
        })
      }
      if (target.endsWith('/v1/github/prs/stream')) {
        streamAttempts += 1
        return new Promise<Response>(() => {})
      }
      return respond({})
    }) as unknown as typeof fetch

    const readings: { lookup: EPullRequestLookup }[] = []
    const port = createPort({
      session: SESSION,
      clientVersion: 'test',
      onReading: ({ reading }) => readings.push(reading),
      clock: { now: () => 0 },
    })

    const first = await port.read({ checkout: CHECKOUT })
    expect(first.lookup).toBe(EPullRequestLookup.Absent)
    expect(streamAttempts).toBe(1)

    const second = await port.read({ checkout: CHECKOUT })
    expect(second.lookup).toBe(EPullRequestLookup.Absent)
    expect(subscribes).toBe(1)
  }, 10_000)

  it('keeps a legacy 404 branch subscribe out of the book so the next read re-probes', async () => {
    let subscribes = 0
    globalThis.fetch = (async (url: unknown) => {
      const target = String(url)
      if (target.endsWith('/v1/github/subscriptions')) {
        subscribes += 1
        return respond({ message: 'no open pull request for branch' }, 404)
      }
      if (target.endsWith('/v1/github/prs/stream')) return new Promise<Response>(() => {})
      return respond({})
    }) as unknown as typeof fetch

    const port = createPort({
      session: SESSION,
      clientVersion: 'test',
      onReading: () => {},
      clock: { now: () => 0 },
    })

    const reading = await port.read({ checkout: CHECKOUT })
    expect(reading).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: true })

    await port.read({ checkout: CHECKOUT })
    expect(subscribes).toBe(2)
  }, 10_000)
})

describe('SsePullRequestPort recovery', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    for (const port of ports.splice(0)) port.dispose()
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
        return new Promise<Response>(() => {})
      }
      return respond({})
    }) as unknown as typeof fetch

    const readings: { lookup: EPullRequestLookup; retryable?: boolean }[] = []
    const port = createPort({
      session: SESSION,
      clientVersion: 'test',
      onReading: ({ reading }) => readings.push(reading),
      clock: { now: () => 0 },
    })

    await port.read({ checkout: CHECKOUT })
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
    const port = createPort({
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

  it('logs the session dying on a refusal and reviving on the next accepted subscribe', async () => {
    const entries: LogEntry[] = []
    let refused = true
    globalThis.fetch = (async (url: unknown) => {
      const target = String(url)
      if (target.endsWith('/v1/github/subscriptions')) {
        return refused ? respond({ message: 'unauthorized' }, 401) : respond(liveSubscribeBody)
      }
      if (target.endsWith('/v1/github/prs/stream')) return new Promise<Response>(() => {})
      return respond({})
    }) as unknown as typeof fetch

    const port = createPort({
      session: SESSION,
      clientVersion: 'test',
      onReading: () => {},
      clock: { now: () => 0 },
      log: {
        port: {
          record: (entry: LogEntry) => entries.push(entry),
          info: (args: { source: string; message: string }) =>
            entries.push({ severity: ELogSeverity.Info, ...args }),
          warn: (args: { source: string; message: string }) =>
            entries.push({ severity: ELogSeverity.Warn, ...args }),
        } as unknown as LogPort,
      },
    })

    await port.read({ checkout: CHECKOUT })
    await port.read({ checkout: CHECKOUT })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      severity: ELogSeverity.Warn,
      source: 'cloud.pull-requests',
    })

    refused = false
    await port.read({ checkout: CHECKOUT })

    expect(entries).toHaveLength(2)
    expect(entries[1]?.severity).toBe(ELogSeverity.Info)
  }, 10_000)
})
