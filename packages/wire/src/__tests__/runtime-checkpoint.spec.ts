import { describe, expect, it } from 'bun:test'

import {
  admissionClosedFor,
  canTransition,
  decodeServeFrame,
  EClientRequest,
  ERuntimePhase,
  EServeFrame,
  readRuntimeCheckpointReplySchema,
  RUNTIME_PHASE_SUCCESSORS,
  runtimeCheckpointSchema,
  sandboxRotationReceiptSchema,
  type RuntimeCheckpoint,
  type SandboxRotationReceipt,
  type ServeFrame,
} from '../index'

const servingCheckpoint = (): RuntimeCheckpoint => ({
  threadId: 'brn_thread_1',
  runtimeId: 'runtime-abc',
  sandboxSessionId: 'sandbox-session-xyz',
  revision: 3,
  phase: ERuntimePhase.Serving,
  reportedAt: '2026-10-01T12:00:00.000Z',
  transcript: { head: 41, count: 40, digest: 'a'.repeat(64) },
})

const checkpoint = (overrides: Record<string, unknown> = {}): RuntimeCheckpoint =>
  ({ ...servingCheckpoint(), ...overrides }) as RuntimeCheckpoint

const updatingCheckpoint = (): RuntimeCheckpoint => {
  const base = {
    threadId: 'brn_thread_1',
    runtimeId: 'runtime-abc',
    sandboxSessionId: 'sandbox-session-xyz',
    revision: 3,
    reportedAt: '2026-10-01T12:00:00.000Z',
    transcript: { head: 41, count: 40, digest: 'a'.repeat(64) },
    phase: ERuntimePhase.Updating as const,
  }
  const receipt: SandboxRotationReceipt = sandboxRotationReceiptSchema.parse({
    version: 1,
    threadId: base.threadId,
    sandboxSessionId: base.sandboxSessionId,
    resumeParent: true,
    checkpoint: base,
  })
  return { ...base, receipt }
}

describe('runtimeCheckpointSchema', () => {
  it('round-trips every lifecycle union member', () => {
    const members: RuntimeCheckpoint[] = [
      checkpoint({ phase: ERuntimePhase.Provisioning }),
      checkpoint({ phase: ERuntimePhase.Serving }),
      checkpoint({ phase: ERuntimePhase.Parking }),
      checkpoint({ phase: ERuntimePhase.Parking, park: { attempts: 2 } }),
      checkpoint({ phase: ERuntimePhase.Parked }),
      checkpoint({ phase: ERuntimePhase.Waking }),
      updatingCheckpoint(),
    ]
    for (const member of members) {
      expect(runtimeCheckpointSchema.parse(JSON.parse(JSON.stringify(member)))).toEqual(member)
    }
  })

  it('rejects the retired phase values outright', () => {
    for (const phase of ['running', 'rotating', 'stopped']) {
      expect(runtimeCheckpointSchema.safeParse({ ...checkpoint(), phase }).success).toBe(false)
    }
  })

  it('requires the rotation receipt on an updating record', () => {
    const withoutReceipt = checkpoint({ phase: ERuntimePhase.Updating }) as unknown
    expect(runtimeCheckpointSchema.safeParse(withoutReceipt).success).toBe(false)
  })

  it('rejects a receipt payload on any other phase', () => {
    const updating = updatingCheckpoint()
    if (updating.phase !== ERuntimePhase.Updating) throw new Error('fixture drift')
    expect(
      runtimeCheckpointSchema.safeParse({ ...checkpoint(), receipt: updating.receipt }).success,
    ).toBe(false)
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

describe('the API-writable wake claim', () => {
  it('carries a wake claim on any phase without disturbing the record', () => {
    for (const phase of [
      ERuntimePhase.Provisioning,
      ERuntimePhase.Serving,
      ERuntimePhase.Parking,
      ERuntimePhase.Parked,
      ERuntimePhase.Waking,
    ]) {
      const claimed = { ...servingCheckpoint(), phase, wakeClaim: 'wake-2026-10-16' }
      const parsed = runtimeCheckpointSchema.parse(claimed)
      expect(parsed.phase).toBe(phase)
      expect(parsed.wakeClaim).toBe('wake-2026-10-16')
    }
  })

  it('leaves the claim off by default so serve never writes it', () => {
    expect(runtimeCheckpointSchema.parse(servingCheckpoint())).not.toHaveProperty('wakeClaim')
  })
})

describe('RUNTIME_PHASE_SUCCESSORS', () => {
  it('covers every lifecycle phase exactly once', () => {
    expect(Object.keys(RUNTIME_PHASE_SUCCESSORS).sort()).toEqual(
      Object.values(ERuntimePhase).sort(),
    )
  })

  it('legalizes exactly the locked transitions', () => {
    const legal: Array<[ERuntimePhase, ERuntimePhase]> = [
      [ERuntimePhase.Provisioning, ERuntimePhase.Serving],
      [ERuntimePhase.Serving, ERuntimePhase.Parking],
      [ERuntimePhase.Serving, ERuntimePhase.Updating],
      [ERuntimePhase.Parking, ERuntimePhase.Parked],
      [ERuntimePhase.Parking, ERuntimePhase.Serving],
      [ERuntimePhase.Parked, ERuntimePhase.Waking],
      [ERuntimePhase.Waking, ERuntimePhase.Serving],
      [ERuntimePhase.Waking, ERuntimePhase.Updating],
      [ERuntimePhase.Updating, ERuntimePhase.Serving],
    ]
    for (const from of Object.values(ERuntimePhase)) {
      for (const to of Object.values(ERuntimePhase)) {
        expect(canTransition({ from, to })).toBe(
          legal.some(([f, t]) => f === from && t === to),
        )
      }
    }
  })
})

describe('admissionClosedFor', () => {
  it('is closed exactly on parking, parked, and updating', () => {
    const closed = Object.values(ERuntimePhase).filter((phase) => admissionClosedFor(phase))
    expect(closed.sort()).toEqual(
      [ERuntimePhase.Parked, ERuntimePhase.Parking, ERuntimePhase.Updating].sort(),
    )
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
