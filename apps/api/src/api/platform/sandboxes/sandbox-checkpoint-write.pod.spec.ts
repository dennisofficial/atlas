import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'
import {
  checkpoint,
  seedCheckpointOwners,
  THREAD,
  USER_A,
  validCheckpoint,
} from '../../../../test/sandbox-checkpoint-fixture'
import { seedThreadRow } from '../../../../test/session-seed'
import { storedCheckpointOf } from './sandbox-checkpoint'
import { createSandboxRoutersApp, putCheckpoint } from './sandbox-routers.fixture'
import { mintSessionToken } from './sandbox-tokens'

const pod = mintSessionToken()

const seedLeasedThread = async (threadId: string = THREAD): Promise<void> => {
  await seedThreadRow({ id: threadId, userId: USER_A })
  await db.orm.public.LocalPodLease.create({
    userId: USER_A,
    threadId,
    tokenHash: pod.tokenHash,
  })
}

const storedForPod = async (threadId: string = THREAD) => {
  const row = await db.orm.public.LocalPodCheckpoint.first({ threadId })
  if (row === null) return null
  return storedCheckpointOf({ threadId, checkpoint: row.checkpoint, revision: row.revision })
}

const dataOf = (reply: { body: unknown }): unknown =>
  (reply.body as { result?: { data?: unknown } }).result?.data

describe('SandboxCheckpointRouter.put from a local pod lease token', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(seedCheckpointOwners)

  const report = (body: unknown) => putCheckpoint({ app, token: pod.token, body })

  it('stores a pod checkpoint when the bearer is a local pod lease token', async () => {
    await seedLeasedThread()

    const reply = await report(validCheckpoint())

    expect(reply.status).toBe(200)
    expect(dataOf(reply)).toEqual({ checkpoint: validCheckpoint() })
    expect(await storedForPod()).toEqual(validCheckpoint())
    expect(await db.orm.public.CloudSandbox.all()).toEqual([])
  })

  it('replaces the pod checkpoint only with a strictly newer revision', async () => {
    await seedLeasedThread()
    const parked = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })
    await report(parked)

    const stale = await report(checkpoint({ revision: 3, phase: ERuntimePhase.Serving }))
    expect(dataOf(stale)).toEqual({ checkpoint: parked })
    expect(await storedForPod()).toEqual(parked)

    const newer = checkpoint({ revision: 5, phase: ERuntimePhase.Serving })
    expect(dataOf(await report(newer))).toEqual({ checkpoint: newer })
    expect(await storedForPod()).toEqual(newer)
  })

  it('never rewrites the pod checkpoint on an equal revision', async () => {
    await seedLeasedThread()
    const parked = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })
    await report(parked)

    const equal = await report(checkpoint({ revision: 4, phase: ERuntimePhase.Serving }))

    expect(dataOf(equal)).toEqual({ checkpoint: parked })
    expect(await storedForPod()).toEqual(parked)
  })

  it('404s a pod whose thread was never registered, writing nothing', async () => {
    await db.orm.public.LocalPodLease.create({
      userId: USER_A,
      threadId: THREAD,
      tokenHash: pod.tokenHash,
    })

    const reply = await report(validCheckpoint())

    expect(reply.status).toBe(404)
    expect(await db.orm.public.LocalPodCheckpoint.all()).toEqual([])
  })

  it('refuses a pod token writing another thread', async () => {
    await seedLeasedThread()
    await seedThreadRow({ id: 'brn_other', userId: USER_A })

    const reply = await report(checkpoint({ threadId: 'brn_other' }))

    expect(reply.status).toBe(403)
    expect(await db.orm.public.LocalPodCheckpoint.all()).toEqual([])
  })
})
