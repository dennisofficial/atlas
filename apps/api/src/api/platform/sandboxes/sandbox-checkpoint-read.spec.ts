import type { INestApplication } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'
import { asJson } from '../../../../test/session-seed'
import {
  checkpoint,
  sandboxRow,
  seedCheckpointOwners,
  storedRow,
  THREAD,
  USER_A,
  USER_B,
} from '../../../../test/sandbox-checkpoint-fixture'
import { storedCheckpointOf } from './sandbox-checkpoint'
import { createSandboxRoutersApp, getCheckpoint } from './sandbox-routers.fixture'

describe('SandboxCheckpointRouter.get', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(seedCheckpointOwners)

  const read = (userId: string | undefined) => getCheckpoint({ app, userId, threadId: THREAD })

  it('answers null when no checkpoint was ever reported', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await read(USER_A)

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { checkpoint: null } } })
  })

  it('answers the stored checkpoint to the owner', async () => {
    await storedRow(checkpoint())

    const reply = await read(USER_A)

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { checkpoint: checkpoint() } } })
  })

  it('404s for a signed-in user who does not own the thread', async () => {
    await storedRow(checkpoint())

    expect((await read(USER_B)).status).toBe(404)
  })

  it('answers 401 without a session', async () => {
    await storedRow(checkpoint())

    expect((await read(undefined)).status).toBe(401)
  })

  it('answers null when the stored payload no longer parses, rather than 500ing', async () => {
    await sandboxRow({
      threadId: THREAD,
      runtimeCheckpoint: { revision: 'later' },
      runtimeCheckpointRevision: 3,
    })

    const reply = await read(USER_A)

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { checkpoint: null } } })
  })

  it('answers null when a stored payload names a thread other than the row', async () => {
    await sandboxRow({
      threadId: THREAD,
      runtimeCheckpoint: asJson(checkpoint({ threadId: 'brn_other' })),
      runtimeCheckpointRevision: 3,
    })

    const reply = await read(USER_A)

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { checkpoint: null } } })
  })
})

describe('storedCheckpointOf', () => {
  it('parses a valid payload only when payload, revision column, and row thread agree', () => {
    expect(storedCheckpointOf({ threadId: THREAD, checkpoint: checkpoint(), revision: 3 })).toEqual(
      checkpoint(),
    )
    expect(
      storedCheckpointOf({ threadId: THREAD, checkpoint: checkpoint(), revision: 4 }),
    ).toBeNull()
    expect(
      storedCheckpointOf({
        threadId: 'brn_other',
        checkpoint: checkpoint(),
        revision: 3,
      }),
    ).toBeNull()
    expect(storedCheckpointOf({ threadId: THREAD, checkpoint: null, revision: null })).toBeNull()
    expect(
      storedCheckpointOf({ threadId: THREAD, checkpoint: checkpoint(), revision: null }),
    ).toBeNull()
    expect(
      storedCheckpointOf({ threadId: THREAD, checkpoint: 'not json-shaped', revision: 3 }),
    ).toBeNull()
  })

  it('reads a parked phase as a first-class stored value', () => {
    const parked = checkpoint({ phase: ERuntimePhase.Parked, revision: 9 })
    expect(storedCheckpointOf({ threadId: THREAD, checkpoint: parked, revision: 9 })).toEqual(
      parked,
    )
  })

  it('reads a retired phase value as unparseable rather than serving it', () => {
    expect(
      storedCheckpointOf({
        threadId: THREAD,
        checkpoint: { ...checkpoint(), phase: 'stopped', revision: 9 },
        revision: 9,
      }),
    ).toBeNull()
  })
})
