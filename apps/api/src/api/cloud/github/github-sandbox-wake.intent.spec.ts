import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import {
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
  useWakeFixture,
} from '../../../../test/github-sandbox-wake-fixture'
import { EPrEventKind } from './github-realtime.types'
import { appendWakeIntent, type WakePrEvent } from './github-sandbox-wake-intent'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { unstubAllGlobals } from '@dltech/bun-test-shims'

const VERDICT: WakePrEvent = {
  userId: 'usr-1',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  payload: {
    url: 'https://github.com/compai/app/pull/42',
    verdict: 'failed',
    headSha: 'abc123',
    settled: true,
  },
}

const prEventRows = () => db.orm.public.Event.where({ threadId: 'thr-1', type: 'pr-event' }).all()

describe('GithubSandboxWakeService durable intent', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('appends the event as a pr-event intent on the thread before booting a claimed pod', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT, VERDICT)
    await flushDebounce()

    expect(calls).toHaveLength(1)
    const rows = await prEventRows()
    expect(rows).toHaveLength(1)
    const body = JSON.parse(rows[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.type).toBe('pr-event')
    expect(body.repo).toBe('github.com/compai/app')
    expect(body.prNumber).toBe(42)
    expect(body.kind).toBe('verdict')
    expect(body.verdict).toBe('failed')
    expect(body.wakeKey).toBe(`pr-wake:thr-1:compai/app:42:verdict:${VERDICT.payload.url}:abc123`)
  })

  it('carries the conversation subscription id so a connected provider dedupes the live frame', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT, VERDICT)
    await flushDebounce()

    const body = JSON.parse((await prEventRows())[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.subscriptionId).toBe('sub-1')
  })

  it('boots without an intent when the caller carries no event', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(1)
    expect(await prEventRows()).toHaveLength(0)
  })

  it('never double-appends the same event when the delivery retries', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const signals = inertSignals()

    await appendWakeIntent({ threadId: 'thr-1', event: VERDICT, signals })
    await appendWakeIntent({ threadId: 'thr-1', event: VERDICT, signals })

    expect(await prEventRows()).toHaveLength(1)
  })
})
