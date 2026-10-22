import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'
import {
  checkpoint,
  sandboxRequest,
  sandboxRow,
  seedCheckpointOwners,
  storedInRow,
  validCheckpoint,
  storedRow,
  THREAD,
} from '../../../../test/sandbox-checkpoint-fixture'
import { SandboxCheckpointController } from './sandbox-checkpoint.controller'
import { mintSessionToken } from './sandbox-tokens'

describe('SandboxCheckpointController reports', () => {
  useTestDatabase()
  beforeEach(seedCheckpointOwners)

  it('stores the first checkpoint a sandbox reports', async () => {
    await sandboxRow({ threadId: THREAD })
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, checkpoint())

    expect(result).toEqual({ checkpoint: checkpoint() })
    expect(await storedInRow()).toEqual(checkpoint())
  })

  it('rejects a body that is not a checkpoint', async () => {
    await sandboxRow({ threadId: THREAD })
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, { phase: 'running' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a checkpoint carrying fields the contract does not know', async () => {
    await sandboxRow({ threadId: THREAD })
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, {
        ...checkpoint(),
        debug: 'extra',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a revision beyond the integer column that stores it', async () => {
    await sandboxRow({ threadId: THREAD })
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
    await sandboxRow({ threadId: THREAD })
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
    await sandboxRow({ threadId: THREAD })
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
    await storedRow(checkpoint({ revision: 3 }))
    const controller = new SandboxCheckpointController()
    const newer = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, newer)

    expect(result).toEqual({ checkpoint: newer })
    expect(await storedInRow()).toEqual(newer)
  })

  it('keeps the stored park when a delayed older revision arrives', async () => {
    const parked = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })
    await storedRow(parked)
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ revision: 3, phase: ERuntimePhase.Serving }),
    )

    expect(result).toEqual({ checkpoint: parked })
    expect(await storedInRow()).toEqual(parked)
  })

  it('never rewrites on an equal revision, even when the phase matches', async () => {
    const stored = checkpoint({ revision: 3 })
    await storedRow(stored)
    const controller = new SandboxCheckpointController()
    const duplicate = checkpoint({
      revision: 3,
      runtimeId: 'runtime-other',
      sandboxSessionId: 'sandbox-session-other',
      reportedAt: '2026-10-01T12:00:01.000Z',
    })

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, duplicate)

    expect(result).toEqual({ checkpoint: stored })
    expect(await storedInRow()).toEqual(stored)
  })

  it('never lets an equal-revision running report rewrite a finalized park', async () => {
    const parked = checkpoint({ revision: 3, phase: ERuntimePhase.Parked })
    await storedRow(parked)
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ revision: 3, phase: ERuntimePhase.Serving }),
    )

    expect(result).toEqual({ checkpoint: parked })
    expect(await storedInRow()).toEqual(parked)
  })

  it('never writes when the session token rotated mid-request', async () => {
    const stored = checkpoint({ revision: 3 })
    const rotated = mintSessionToken()
    await storedRow(stored, { tokenHash: rotated.tokenHash })
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ revision: 4, phase: ERuntimePhase.Parked }),
    )

    expect(result).toEqual({ checkpoint: stored })
    expect(await storedInRow()).toEqual(stored)
  })

  it('treats a revision-less stored payload as empty, so reporting recovers', async () => {
    await sandboxRow({ threadId: THREAD, runtimeCheckpoint: { garbage: true } })
    const controller = new SandboxCheckpointController()

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, checkpoint())

    expect(result).toEqual({ checkpoint: checkpoint() })
    expect(await storedInRow()).toEqual(checkpoint())
  })

  it('leaves the sandbox state column alone: reports are metadata, not lifecycle', async () => {
    await sandboxRow({ threadId: THREAD, state: 'running' })
    const controller = new SandboxCheckpointController()

    await controller.handlePutCheckpoint(
      sandboxRequest({}),
      THREAD,
      checkpoint({ phase: ERuntimePhase.Parked }),
    )

    expect((await db.orm.public.CloudSandbox.first())?.state).toBe('running')
  })

  it('round-trips an updating checkpoint carrying its rotation receipt through the fence', async () => {
    await storedRow(checkpoint({ revision: 3 }))
    const controller = new SandboxCheckpointController()
    const base = {
      threadId: THREAD,
      runtimeId: 'runtime-abc',
      sandboxSessionId: 'sandbox-session-xyz',
      revision: 4,
      reportedAt: '2026-10-01T12:00:00.000Z',
      transcript: { head: 42, count: 41, digest: 'c'.repeat(64) },
      phase: ERuntimePhase.Updating as const,
    }
    const updating = validCheckpoint({
      ...base,
      receipt: {
        version: 1,
        threadId: base.threadId,
        sandboxSessionId: base.sandboxSessionId,
        resumeParent: true,
        checkpoint: base,
      },
    })

    const result = await controller.handlePutCheckpoint(sandboxRequest({}), THREAD, updating)

    expect(result).toEqual({ checkpoint: updating })
    expect(await storedInRow()).toEqual(updating)
  })

  it('rejects an updating checkpoint without its receipt', async () => {
    await storedRow(checkpoint({ revision: 3 }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, {
        ...checkpoint({ revision: 4 }),
        phase: ERuntimePhase.Updating,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a checkpoint still carrying a retired phase value', async () => {
    await storedRow(checkpoint({ revision: 3 }))
    const controller = new SandboxCheckpointController()

    await expect(
      controller.handlePutCheckpoint(sandboxRequest({}), THREAD, {
        ...checkpoint({ revision: 4 }),
        phase: 'rotating',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
