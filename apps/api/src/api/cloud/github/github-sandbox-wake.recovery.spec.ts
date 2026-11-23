import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import {
  fakeBoot,
  patchSandbox,
  pastDate,
  PR_EVENT,
  readSandbox,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
  settleLookups,
  useWakeFixture,
} from '../../../../test/github-sandbox-wake-fixture'
import { EPrEventKind } from '@dltech/atlas-github'
import type { WakePrEvent } from './github-sandbox-wake-intent'
import { owedWakeTargets } from './github-sandbox-wake-linked'

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
  eventId: 'evt-recover',
}

describe('GithubSandboxWakeService recovery of an owed intent', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('boots once for a debounced wake whose process died before the timer fired', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const doomed = serviceWith({ boot: fakeBoot().boot })

    await doomed.notifyEvent(PR_EVENT, VERDICT)
    await settleLookups()

    expect(
      await db.orm.public.Event.where({ threadId: 'thr-1', type: 'pr-event' }).all(),
    ).toHaveLength(1)
    expect((await readSandbox()).wakeClaim).toBeNull()

    const { boot, calls } = fakeBoot()
    const recovery = serviceWith({ boot })

    await recovery.retryFailedWakes()

    expect(calls.map((call) => call.threadId)).toEqual(['thr-1'])
    await recovery.retryFailedWakes()
    expect(calls).toHaveLength(1)
  })

  it('boots an accepted intent the sandbox activity window has since aged out', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const doomed = serviceWith({ boot: fakeBoot().boot })

    await doomed.notifyEvent(PR_EVENT, VERDICT)
    await settleLookups()
    await patchSandbox({ lastActivityAt: pastDate(25 * 60 * 60 * 1_000) })

    const { boot, calls } = fakeBoot()
    const recovery = serviceWith({ boot })

    await recovery.retryFailedWakes()

    expect(calls.map((call) => call.threadId)).toEqual(['thr-1'])
  })

  it('leaves the accepted intent of a retired pod alone', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const doomed = serviceWith({ boot: fakeBoot().boot })

    await doomed.notifyEvent(PR_EVENT, VERDICT)
    await settleLookups()
    await patchSandbox({ retiredAt: new Date() })

    const { boot, calls } = fakeBoot()
    const recovery = serviceWith({ boot })

    await recovery.retryFailedWakes()

    expect(calls).toHaveLength(0)
  })

  it('leaves the accepted intent of an archived session alone', async () => {
    await seedParkedSandbox()
    await seedSubscription()
    const doomed = serviceWith({ boot: fakeBoot().boot })

    await doomed.notifyEvent(PR_EVENT, VERDICT)
    await settleLookups()
    await db.orm.public.Session.where({ id: 'ses_thr-1' }).update({ archivedAt: new Date() })

    const { boot, calls } = fakeBoot()
    const recovery = serviceWith({ boot })

    await recovery.retryFailedWakes()

    expect(calls).toHaveLength(0)
  })
})

describe('owedWakeTargets over a parked sandbox with an owed intent', () => {
  useTestDatabase()
  useWakeFixture()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  const owedThreadIds = async (): Promise<string[]> =>
    (await owedWakeTargets()).map((target) => target.threadId).sort()

  const seedOwedIntents = async (): Promise<void> => {
    await seedParkedSandbox()
    await seedParkedSandbox({ threadId: 'thr-2', tokenHash: 'stored-hash-2' })
    await seedSubscription()
    await seedSubscription({ threadId: 'thr-2' })
    await serviceWith({ boot: fakeBoot().boot }).notifyEvent(PR_EVENT, VERDICT)
    await settleLookups()
  }

  it('excludes the parked sandbox of an archived session', async () => {
    await seedOwedIntents()
    expect(await owedThreadIds()).toEqual(['thr-1', 'thr-2'])

    await db.orm.public.Session.where({ id: 'ses_thr-2' }).update({ archivedAt: new Date() })

    expect(await owedThreadIds()).toEqual(['thr-1'])
  })

  it('excludes the parked sandbox of a deleted session', async () => {
    await seedOwedIntents()
    expect(await owedThreadIds()).toEqual(['thr-1', 'thr-2'])

    await db.orm.public.Session.where({ id: 'ses_thr-2' }).update({ deletedAt: new Date() })

    expect(await owedThreadIds()).toEqual(['thr-1'])
  })
})
