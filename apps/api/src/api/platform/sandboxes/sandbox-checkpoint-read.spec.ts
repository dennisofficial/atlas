import { NotFoundException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'
import { asJson } from '../../../../test/session-seed'
import {
  checkpoint,
  ownerRequest,
  sandboxRow,
  seedCheckpointOwners,
  storedRow,
  THREAD,
  USER_A,
  USER_B,
} from '../../../../test/sandbox-checkpoint-fixture'
import { storedCheckpointOf } from './sandbox-checkpoint'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'

describe('SandboxCheckpointController reads', () => {
  useTestDatabase()
  beforeEach(seedCheckpointOwners)

  it('answers null when no checkpoint was ever reported', async () => {
    await sandboxRow({ threadId: THREAD })
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: null })
  })

  it('answers the stored checkpoint to the owner', async () => {
    await storedRow(checkpoint())
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: checkpoint() })
  })

  it('404s for a signed-in user who does not own the thread', async () => {
    await storedRow(checkpoint())
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handleGetCheckpoint(ownerRequest(USER_B), THREAD),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers null when the stored payload no longer parses, rather than 500ing', async () => {
    await sandboxRow({
      threadId: THREAD,
      runtimeCheckpoint: { revision: 'later' },
      runtimeCheckpointRevision: 3,
    })
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: null })
  })

  it('answers null when a stored payload names a thread other than the row', async () => {
    await sandboxRow({
      threadId: THREAD,
      runtimeCheckpoint: asJson(checkpoint({ threadId: 'brn_other' })),
      runtimeCheckpointRevision: 3,
    })
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: null })
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
