import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import {
  fakeBoot,
  PR_EVENT,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
  settleLookups,
  useWakeFixture,
} from '../../../../test/github-sandbox-wake-fixture'
import { EPrEventKind } from './github-realtime.types'
import type { WakePrEvent } from './github-sandbox-wake-intent'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'

const VERDICT: WakePrEvent = {
  userId: 'usr-1',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  payload: {
    url: 'https://github.com/compai/app/pull/42',
    verdict: 'green',
    headSha: 'abc123',
    settled: true,
  },
  eventId: 'evt-settle',
}

describe('GithubSandboxWakeService settle preserves the captured event', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('drains a pending debounce entry by booting with its captured event, so the intent lands', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const { boot, calls } = fakeBoot()
    const wake = serviceWith({ boot })

    wake.notifyEvent(PR_EVENT, VERDICT)
    await settleLookups()
    await advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(0)

    await wake.settle()

    expect(calls).toHaveLength(1)
    const rows = await db.orm.public.Event.where({ threadId: 'thr-1', type: 'pr-event' }).all()
    expect(rows).toHaveLength(1)
    const body = JSON.parse(rows[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.eventId).toBe('evt-settle')
    expect(body.verdict).toBe('green')
  })
})
