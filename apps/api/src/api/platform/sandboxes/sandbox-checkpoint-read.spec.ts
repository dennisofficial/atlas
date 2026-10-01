import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERuntimePhase } from '@dltech/atlas-wire'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeSessionDb } = await import('../../../../test/fake-session-db.js')
  return { db: fakeSessionDb().db as unknown as PrismaClient }
})

import {
  checkpoint,
  fake,
  ownerRequest,
  sandboxRow,
  storedRow,
  THREAD,
  USER_A,
  USER_B,
} from '../../../../test/sandbox-checkpoint-fixture'
import { storedCheckpointOf } from './sandbox-checkpoint'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'

beforeEach(() => {
  fake.reset()
})

describe('SandboxCheckpointController reads', () => {
  it('answers null when no checkpoint was ever reported', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: null })
  })

  it('answers the stored checkpoint to the owner', async () => {
    fake.cloudSandboxes.push(storedRow(checkpoint()))
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: checkpoint() })
  })

  it('404s for a signed-in user who does not own the thread', async () => {
    fake.cloudSandboxes.push(storedRow(checkpoint()))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handleGetCheckpoint(ownerRequest(USER_B), THREAD),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers null when the stored payload no longer parses, rather than 500ing', async () => {
    fake.cloudSandboxes.push(
      sandboxRow({
        threadId: THREAD,
        runtimeCheckpoint: { revision: 'later' },
        runtimeCheckpointRevision: 3,
      }),
    )
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: null })
  })

  it('answers null when a stored payload names a thread other than the row', async () => {
    fake.cloudSandboxes.push(
      sandboxRow({
        threadId: THREAD,
        runtimeCheckpoint: checkpoint({ threadId: 'brn_other' }),
        runtimeCheckpointRevision: 3,
      }),
    )
    const controller = new SandboxCheckpointController()

    const result = await controller.handleGetCheckpoint(ownerRequest(USER_A), THREAD)

    expect(result).toEqual({ checkpoint: null })
  })
})

describe('storedCheckpointOf', () => {
  it('parses a valid payload only when payload, revision column, and row thread agree', () => {
    expect(
      storedCheckpointOf({ threadId: THREAD, checkpoint: checkpoint(), revision: 3 }),
    ).toEqual(checkpoint())
    expect(storedCheckpointOf({ threadId: THREAD, checkpoint: checkpoint(), revision: 4 })).toBeNull()
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

  it('reads a stopped phase as a first-class stored value', () => {
    const stopped = checkpoint({ phase: ERuntimePhase.Stopped, revision: 9 })
    expect(
      storedCheckpointOf({ threadId: THREAD, checkpoint: stopped, revision: 9 }),
    ).toEqual(stopped)
  })
})
