import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'
import {
  checkpoint,
  minted,
  sandboxRow,
  seedCheckpointOwners,
  storedInRow,
  storedRow,
  THREAD,
  USER_A,
  validCheckpoint,
} from '../../../../test/sandbox-checkpoint-fixture'
import { createSandboxRoutersApp, putCheckpoint } from './sandbox-routers.fixture'
import { mintSessionToken } from './sandbox-tokens'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind, type TokenPrincipal } from './token-principal'

const verifiesEveryToken = {
  async verifyTokenPrincipal(): Promise<TokenPrincipal> {
    return { kind: ETokenPrincipalKind.Sandbox, id: 'sbx', threadId: THREAD, userId: USER_A }
  },
} as unknown as SandboxesService

describe('SandboxCheckpointRouter.put', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp(verifiesEveryToken)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(seedCheckpointOwners)

  const report = (body: unknown, token: string | undefined = minted.token) =>
    putCheckpoint({ app, token, body })

  const dataOf = (reply: { body: unknown }): unknown => {
    const body = reply.body as { result?: { data?: unknown } }
    return body.result?.data
  }

  it('stores the first checkpoint a sandbox reports', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await report(checkpoint())

    expect(reply.status).toBe(200)
    expect(dataOf(reply)).toEqual({ checkpoint: checkpoint() })
    expect(await storedInRow()).toEqual(checkpoint())
  })

  it('rejects a body that is not a checkpoint', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await report({ threadId: THREAD, phase: 'running' })

    expect(reply.status).toBe(400)
    expect(await storedInRow()).toBeNull()
  })

  it('rejects a checkpoint carrying fields the contract does not know', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await report({ ...checkpoint(), debug: 'extra' })

    expect(reply.status).toBe(400)
    expect(await storedInRow()).toBeNull()
  })

  it('rejects a revision beyond the integer column that stores it', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await report(checkpoint({ revision: 2147483648 }))

    expect(reply.status).toBe(400)
  })

  it('refuses a body with no thread at all before touching the row', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await report({ phase: 'running' })

    expect(reply.status).toBe(400)
    expect(await storedInRow()).toBeNull()
  })

  it('404s when the sandbox row is gone', async () => {
    const reply = await report(checkpoint())

    expect(reply.status).toBe(404)
  })

  it('replaces a stored checkpoint only with a strictly newer revision', async () => {
    await storedRow(checkpoint({ revision: 3 }))
    const newer = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })

    const reply = await report(newer)

    expect(dataOf(reply)).toEqual({ checkpoint: newer })
    expect(await storedInRow()).toEqual(newer)
  })

  it('keeps the stored park when a delayed older revision arrives', async () => {
    const parked = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })
    await storedRow(parked)

    const reply = await report(checkpoint({ revision: 3, phase: ERuntimePhase.Serving }))

    expect(dataOf(reply)).toEqual({ checkpoint: parked })
    expect(await storedInRow()).toEqual(parked)
  })

  it('never rewrites on an equal revision, even when the phase matches', async () => {
    const stored = checkpoint({ revision: 3 })
    await storedRow(stored)
    const duplicate = checkpoint({
      revision: 3,
      runtimeId: 'runtime-other',
      sandboxSessionId: 'sandbox-session-other',
      reportedAt: '2026-10-01T12:00:01.000Z',
    })

    const reply = await report(duplicate)

    expect(dataOf(reply)).toEqual({ checkpoint: stored })
    expect(await storedInRow()).toEqual(stored)
  })

  it('never lets an equal-revision running report rewrite a finalized park', async () => {
    const parked = checkpoint({ revision: 3, phase: ERuntimePhase.Parked })
    await storedRow(parked)

    const reply = await report(checkpoint({ revision: 3, phase: ERuntimePhase.Serving }))

    expect(dataOf(reply)).toEqual({ checkpoint: parked })
    expect(await storedInRow()).toEqual(parked)
  })

  it('never writes when the session token rotated mid-request', async () => {
    const stored = checkpoint({ revision: 3 })
    const rotated = mintSessionToken()
    await storedRow(stored, { tokenHash: rotated.tokenHash })

    const reply = await report(checkpoint({ revision: 4, phase: ERuntimePhase.Parked }))

    expect(dataOf(reply)).toEqual({ checkpoint: stored })
    expect(await storedInRow()).toEqual(stored)
  })

  it('treats a revision-less stored payload as empty, so reporting recovers', async () => {
    await sandboxRow({ threadId: THREAD, runtimeCheckpoint: { garbage: true } })

    const reply = await report(checkpoint())

    expect(dataOf(reply)).toEqual({ checkpoint: checkpoint() })
    expect(await storedInRow()).toEqual(checkpoint())
  })

  it('leaves the sandbox state column alone: reports are metadata, not lifecycle', async () => {
    await sandboxRow({ threadId: THREAD, state: 'running' })

    await report(checkpoint({ phase: ERuntimePhase.Parked }))

    expect((await db.orm.public.CloudSandbox.first())?.state).toBe('running')
  })

  it('round-trips an updating checkpoint carrying its rotation receipt through the fence', async () => {
    await storedRow(checkpoint({ revision: 3 }))
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

    const reply = await report(updating)

    expect(dataOf(reply)).toEqual({ checkpoint: updating })
    expect(await storedInRow()).toEqual(updating)
  })

  it('rejects an updating checkpoint without its receipt', async () => {
    await storedRow(checkpoint({ revision: 3 }))

    const reply = await report({ ...checkpoint({ revision: 4 }), phase: ERuntimePhase.Updating })

    expect(reply.status).toBe(400)
  })

  it('rejects a checkpoint still carrying a retired phase value', async () => {
    await storedRow(checkpoint({ revision: 3 }))

    const reply = await report({ ...checkpoint({ revision: 4 }), phase: 'rotating' })

    expect(reply.status).toBe(400)
  })
})

describe('SandboxCheckpointRouter.put thread token', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(seedCheckpointOwners)

  it('stores a report from the token that owns the thread named in the body', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await putCheckpoint({ app, token: minted.token, body: checkpoint() })

    expect(reply.status).toBe(200)
    expect(await storedInRow()).toEqual(checkpoint())
  })

  it('rejects a report when the token and the body disagree about the thread', async () => {
    await sandboxRow({ threadId: THREAD })
    await sandboxRow({
      threadId: 'brn_other',
      id: 'sbx_other',
      tokenHash: mintSessionToken().tokenHash,
    })

    const reply = await putCheckpoint({
      app,
      token: minted.token,
      body: checkpoint({ threadId: 'brn_other' }),
    })

    expect(reply.status).toBe(403)
    expect(await storedInRow()).toBeNull()
  })

  it('refuses a request carrying no bearer token', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await putCheckpoint({ app, token: undefined, body: checkpoint() })

    expect(reply.status).toBe(401)
  })

  it('refuses a token that is not the thread session token', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await putCheckpoint({ app, token: 'wrong-token', body: checkpoint() })

    expect(reply.status).toBe(401)
    expect(await storedInRow()).toBeNull()
  })

  it('refuses a body whose thread is not a string', async () => {
    await sandboxRow({ threadId: THREAD })

    const reply = await putCheckpoint({
      app,
      token: minted.token,
      body: { ...checkpoint(), threadId: 7 },
    })

    expect(reply.status).toBe(400)
    expect(await storedInRow()).toBeNull()
  })
})
