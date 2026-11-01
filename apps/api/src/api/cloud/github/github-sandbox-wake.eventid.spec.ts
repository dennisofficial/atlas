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
import type { WakePrEvent } from './github-sandbox-wake-intent'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { appendWakeIntent } from './github-sandbox-wake-intent'

const verdict = (eventId: string, verdictValue: 'green' | 'failed'): WakePrEvent => ({
  userId: 'usr-1',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  payload: {
    url: 'https://github.com/compai/app/pull/42',
    verdict: verdictValue,
    headSha: 'abc123',
    settled: true,
  },
  eventId,
})

const prEventRows = () => db.orm.public.Event.where({ threadId: 'thr-1', type: 'pr-event' }).all()

describe('GithubSandboxWakeService wake-intent identity', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keys the wake intent by mailbox event id, so failed and green on one SHA both append', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const signals = inertSignals()

    await appendWakeIntent({ threadId: 'thr-1', event: verdict('evt-failed', 'failed'), signals })
    await appendWakeIntent({ threadId: 'thr-1', event: verdict('evt-green', 'green'), signals })

    const rows = await prEventRows()
    expect(rows).toHaveLength(2)
    const keys = rows.map((row) => (JSON.parse(row.body) as Record<string, unknown>).wakeKey)
    expect(keys).toContain('pr-wake:thr-1:evt-failed')
    expect(keys).toContain('pr-wake:thr-1:evt-green')
  })

  it('dedupes a retried delivery of the same mailbox event id', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const signals = inertSignals()

    await appendWakeIntent({ threadId: 'thr-1', event: verdict('evt-1', 'failed'), signals })
    await appendWakeIntent({ threadId: 'thr-1', event: verdict('evt-1', 'failed'), signals })

    expect(await prEventRows()).toHaveLength(1)
  })

  it('appends the intent for a CAS loser instead of dropping the event', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    // Occupy the claim: the first event wins the boot, the second races in while the claim is
    // held and must still leave a durable intent for the pod to hydrate.
    wake.notifyEvent(PR_EVENT, verdict('evt-winner', 'failed'))
    await flushDebounce()
    expect(calls).toHaveLength(1)

    const signals = inertSignals()
    await appendWakeIntent({ threadId: 'thr-1', event: verdict('evt-loser', 'green'), signals })

    const rows = await prEventRows()
    expect(rows.map((row) => (JSON.parse(row.body) as Record<string, unknown>).eventId)).toEqual(
      expect.arrayContaining(['evt-winner', 'evt-loser']),
    )
  })
})
