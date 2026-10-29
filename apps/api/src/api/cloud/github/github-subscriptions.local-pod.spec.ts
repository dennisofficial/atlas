import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { ensureUsers, subscriptionRows } from '../../../../test/github-seed'
import { serviceWith } from './github-subscriptions.fixture'

const DAY_MS = 24 * 60 * 60 * 1_000

describe('local-pod linked subscriptions', () => {
  useTestDatabase()
  afterEach(() => unstubAllGlobals())

  beforeEach(async () => {
    await ensureUsers('usr_1')
    await db.orm.public.LocalPodLease.create({
      userId: 'usr_1',
      threadId: 'thr_local',
      tokenHash: 'hash-local',
    })
  })

  it('stays live through the park-wake window of the pod’s lease', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_local',
    })

    const [row] = await subscriptionRows()
    expect(row?.threadId).toBe('thr_local')
    expect(row?.liveUntil.getTime()).toBeGreaterThan(Date.now() + DAY_MS - 60_000)
  })
})
