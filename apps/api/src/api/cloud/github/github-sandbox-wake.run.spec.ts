import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

import {
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  seedParkedSandbox,
  serviceWith,
  useWakeFixture,
} from '../../../../test/github-sandbox-wake-fixture'
import { seedSubscription as seedSubscriptionRow } from '../../../../test/github-seed'
import { unstubAllGlobals } from '@dltech/bun-test-shims'

const RUN_EVENT = { userId: 'usr-1', repoFullName: 'compai/app', kind: 'workflow-run' } as const

const seedRunSubscription = (overrides: { liveUntil?: Date } = {}) =>
  seedSubscriptionRow({
    userId: 'usr-1',
    repoFullName: 'compai/app',
    branch: '#run:9001',
    prNumber: null,
    kind: 'workflow-run',
    threadId: 'thr-1',
    liveUntil: overrides.liveUntil ?? new Date(Date.now() + 60_000),
  })

describe('GithubSandboxWakeService run wake', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('boots the thread a live workflow-run row links', async () => {
    await seedParkedSandbox()
    await seedRunSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(RUN_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.threadId).toBe('thr-1')
  })

  it('leaves an expired workflow-run row alone', async () => {
    await seedParkedSandbox()
    await seedRunSubscription({ liveUntil: new Date(Date.now() - 1) })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(RUN_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('does not boot a run row for a pull-request notice', async () => {
    await seedParkedSandbox()
    await seedRunSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })
})
