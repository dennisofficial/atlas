import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  fakeBoot,
  PR_EVENT,
  serviceWith,
  settleLookups,
} from '../../../../test/github-sandbox-wake-fixture'
import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'

const LOCAL_THREAD = 'thr-local'

function rig() {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wakes: string[] = []
  fanout.openStream({
    userId: PR_EVENT.userId,
    handler: () => undefined,
    wakeHandler: (threadId) => wakes.push(threadId),
  })
  const { boot, calls } = fakeBoot()
  const service = serviceWith({ boot, fanout, debounceMs: 0 })
  return { service, wakes, calls }
}

describe('GithubSandboxWakeService for local pods', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(PR_EVENT.userId)
    await db.orm.public.LocalPodLease.create({
      userId: PR_EVENT.userId,
      threadId: LOCAL_THREAD,
      tokenHash: 'hash-local',
    })
    await seedSubscription({ userId: PR_EVENT.userId, threadId: LOCAL_THREAD })
  })

  it('pushes one wake frame for the local-pod thread per event burst', async () => {
    const { service, wakes, calls } = rig()

    service.notifyEvent(PR_EVENT)
    service.notifyEvent(PR_EVENT)
    await settleLookups()

    expect(wakes).toEqual([LOCAL_THREAD])
    expect(calls).toHaveLength(0)
  })

  it('pushes nothing for a thread whose subscription is no longer live', async () => {
    await db.orm.public.GithubSubscription.where({ threadId: LOCAL_THREAD }).update({
      liveUntil: new Date(Date.now() - 60_000),
    })
    const { service, wakes } = rig()

    service.notifyEvent(PR_EVENT)
    await settleLookups()

    expect(wakes).toEqual([])
  })
})
