import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
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
  sandboxRequest,
  sandboxRow,
  storedInRow,
  storedRow,
  THREAD,
} from '../../../../test/sandbox-checkpoint-fixture'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'
import { mintSessionToken } from './sandbox-tokens'

beforeEach(() => {
  fake.reset()
})

describe('SandboxCheckpointController reports', () => {
  it('stores the first checkpoint a sandbox reports', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, checkpoint())

    expect(result).toEqual({ checkpoint: checkpoint() })
    expect(storedInRow()).toEqual(checkpoint())
  })

  it('rejects a body that is not a checkpoint', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, { phase: 'running' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a checkpoint carrying fields the contract does not know', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, {
        ...checkpoint(),
        debug: 'extra',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a revision beyond the integer column that stores it', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(
        sandboxRequest({}),
        THREAD,
        checkpoint({ revision: 2147483648 }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a checkpoint naming a thread other than the route and token', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(
        sandboxRequest({}),
        THREAD,
        checkpoint({ threadId: 'brn_other' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a report when the token and route disagree about the thread', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(
        sandboxRequest({ threadId: 'brn_other' }),
        THREAD,
        checkpoint(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('404s when the sandbox row is gone', async () => {
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, checkpoint()),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('replaces a stored checkpoint only with a strictly newer revision', async () => {
    fake.cloudSandboxes.push(storedRow(checkpoint({ revision: 3 })))
    const controller = new SandboxCheckpointController()
    const newer = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, newer)

    expect(result).toEqual({ checkpoint: newer })
    expect(storedInRow()).toEqual(newer)
  })

  it('keeps the stored park when a delayed older revision arrives', async () => {
    const parked = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })
    fake.cloudSandboxes.push(storedRow(parked))
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ revision: 3, phase: ERuntimePhase.Running }),
    )

    expect(result).toEqual({ checkpoint: parked })
    expect(storedInRow()).toEqual(parked)
  })

  it('never rewrites on an equal revision, even when the phase matches', async () => {
    const stored = checkpoint({ revision: 3 })
    fake.cloudSandboxes.push(storedRow(stored))
    const controller = new SandboxCheckpointController()
    const duplicate = checkpoint({
      revision: 3,
      runtimeId: 'runtime-other',
      sandboxSessionId: 'sandbox-session-other',
      reportedAt: '2026-10-01T12:00:01.000Z',
    })

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, duplicate)

    expect(result).toEqual({ checkpoint: stored })
    expect(storedInRow()).toEqual(stored)
  })

  it('never lets an equal-revision running report rewrite a finalized park', async () => {
    const parked = checkpoint({ revision: 3, phase: ERuntimePhase.Parked })
    fake.cloudSandboxes.push(storedRow(parked))
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ revision: 3, phase: ERuntimePhase.Running }),
    )

    expect(result).toEqual({ checkpoint: parked })
    expect(storedInRow()).toEqual(parked)
  })

  it('never writes when the session token rotated mid-request', async () => {
    const stored = checkpoint({ revision: 3 })
    const rotated = mintSessionToken()
    fake.cloudSandboxes.push(storedRow(stored, { tokenHash: rotated.tokenHash }))
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ revision: 4, phase: ERuntimePhase.Parked }),
    )

    expect(result).toEqual({ checkpoint: stored })
    expect(storedInRow()).toEqual(stored)
  })

  it('treats a revision-less stored payload as empty, so reporting recovers', async () => {
    fake.cloudSandboxes.push(
      sandboxRow({ threadId: THREAD, runtimeCheckpoint: { garbage: true } }),
    )
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, checkpoint())

    expect(result).toEqual({ checkpoint: checkpoint() })
    expect(storedInRow()).toEqual(checkpoint())
  })

  it('leaves the sandbox state column alone: reports are metadata, not lifecycle', async () => {
    fake.cloudSandboxes.push(sandboxRow({ threadId: THREAD, state: 'running' }))
    const controller = new SandboxCheckpointController()

    await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ phase: ERuntimePhase.Parked }),
    )

    expect(fake.cloudSandboxes[0]?.state).toBe('running')
  })
})
