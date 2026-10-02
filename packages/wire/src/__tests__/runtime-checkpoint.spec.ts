import { describe, expect, it } from 'bun:test'

import {
  decodeServeFrame,
  EClientRequest,
  ERuntimePhase,
  EServeFrame,
  readRuntimeCheckpointReplySchema,
  runtimeCheckpointSchema,
  type RuntimeCheckpoint,
  type ServeFrame,
} from '../index'

const checkpoint = (overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint => ({
  threadId: 'brn_thread_1',
  runtimeId: 'runtime-abc',
  sandboxSessionId: 'sandbox-session-xyz',
  revision: 3,
  phase: ERuntimePhase.Running,
  reportedAt: '2026-10-01T12:00:00.000Z',
  transcript: { head: 41, count: 40, digest: 'a'.repeat(64) },
  ...overrides,
})

describe('runtimeCheckpointSchema', () => {
  it('accepts a well-formed checkpoint', () => {
    expect(runtimeCheckpointSchema.safeParse(checkpoint()).success).toBe(true)
  })

  it('rejects a revision that is not a positive integer', () => {
    expect(runtimeCheckpointSchema.safeParse(checkpoint({ revision: 0 })).success).toBe(false)
    expect(runtimeCheckpointSchema.safeParse(checkpoint({ revision: 1.5 })).success).toBe(false)
  })

  it('rejects an unknown phase', () => {
    expect(runtimeCheckpointSchema.safeParse({ ...checkpoint(), phase: 'melting' }).success).toBe(
      false,
    )
  })

  it('rejects a transcript digest that is not 64 lowercase hex characters', () => {
    expect(
      runtimeCheckpointSchema.safeParse({
        ...checkpoint(),
        transcript: { head: 1, count: 1, digest: 'not-a-digest' },
      }).success,
    ).toBe(false)
    expect(
      runtimeCheckpointSchema.safeParse({
        ...checkpoint(),
        transcript: { head: 1, count: 1, digest: 'A'.repeat(64) },
      }).success,
    ).toBe(false)
  })

  it('rejects a missing sandboxSessionId', () => {
    const { sandboxSessionId: _dropped, ...without } = checkpoint()
    expect(runtimeCheckpointSchema.safeParse(without).success).toBe(false)
  })

  it('rejects a reportedAt that is not an ISO timestamp', () => {
    expect(runtimeCheckpointSchema.safeParse(checkpoint({ reportedAt: 'soon' })).success).toBe(
      false,
    )
  })

  it('rejects a revision beyond the PostgreSQL integer range the API stores it in', () => {
    expect(
      runtimeCheckpointSchema.safeParse(checkpoint({ revision: 2147483647 })).success,
    ).toBe(true)
    expect(
      runtimeCheckpointSchema.safeParse(checkpoint({ revision: 2147483648 })).success,
    ).toBe(false)
  })

  it('rejects unknown fields at the top level and inside the transcript', () => {
    expect(
      runtimeCheckpointSchema.safeParse({ ...checkpoint(), debug: 'extra' }).success,
    ).toBe(false)
    expect(
      runtimeCheckpointSchema.safeParse({
        ...checkpoint(),
        transcript: { ...checkpoint().transcript, note: 'extra' },
      }).success,
    ).toBe(false)
  })
})

describe('checkpoint on the channel frames', () => {
  it('round-trips a ready frame carrying a checkpoint', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.Ready,
      seq: 7,
      checkpoint: checkpoint(),
    }

    expect(decodeServeFrame(JSON.stringify(frame))).toEqual(frame)
  })

  it('round-trips a ready frame without a checkpoint, as an old serve sends it', () => {
    const frame: ServeFrame = { kind: EServeFrame.Ready, seq: 7 }

    expect(decodeServeFrame(JSON.stringify(frame))).toEqual(frame)
  })

  it('round-trips a parked frame carrying its finalized checkpoint', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.Parked,
      reason: 'idle timeout',
      checkpoint: checkpoint({ phase: ERuntimePhase.Parked }),
    }

    expect(decodeServeFrame(JSON.stringify(frame))).toEqual(frame)
  })

  it('round-trips the checkpoint frame itself', () => {
    const frame: ServeFrame = { kind: EServeFrame.Checkpoint, checkpoint: checkpoint() }

    expect(decodeServeFrame(JSON.stringify(frame))).toEqual(frame)
  })

  it('drops a checkpoint frame whose payload is not a checkpoint', () => {
    expect(decodeServeFrame(JSON.stringify({ kind: EServeFrame.Checkpoint, checkpoint: {} }))).toBeNull()
  })

  it('keeps a ready frame whose checkpoint metadata is malformed, reading it as unknown', () => {
    expect(
      decodeServeFrame(JSON.stringify({ kind: EServeFrame.Ready, seq: 7, checkpoint: { bogus: 1 } })),
    ).toEqual({ kind: EServeFrame.Ready, seq: 7, checkpoint: null })
  })

  it('keeps a parked frame whose checkpoint metadata is malformed, preserving the lifecycle state', () => {
    expect(
      decodeServeFrame(
        JSON.stringify({ kind: EServeFrame.Parked, reason: 'idle timeout', checkpoint: 'junk' }),
      ),
    ).toEqual({ kind: EServeFrame.Parked, reason: 'idle timeout', checkpoint: null })
  })
})

describe('readRuntimeCheckpointReplySchema', () => {
  it('accepts a null checkpoint, the pre-first-report answer', () => {
    expect(readRuntimeCheckpointReplySchema.safeParse({ checkpoint: null }).success).toBe(true)
  })

  it('accepts a stored checkpoint', () => {
    expect(
      readRuntimeCheckpointReplySchema.safeParse({ checkpoint: checkpoint() }).success,
    ).toBe(true)
  })

  it('registers the client request op', () => {
    const op: string = EClientRequest.ReadRuntimeCheckpoint
    expect(op).toBe('read-runtime-checkpoint')
  })
})
