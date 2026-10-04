import { describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '../runtime-checkpoint'
import { sandboxDrainReplySchema, sandboxRotationReceiptSchema, sandboxRotationStateSchema, type SandboxRotationReceipt } from '../sandbox-rotation'

const receipt: SandboxRotationReceipt = {
  version: 1, threadId: 'root', sandboxSessionId: 'source-session', resumeParent: true,
  checkpoint: {
    threadId: 'root', sandboxSessionId: 'source-session', runtimeId: 'source-runtime', revision: 1,
    phase: ERuntimePhase.Rotating, reportedAt: '2026-10-03T00:00:00Z',
    transcript: { head: 1, count: 1, digest: 'a'.repeat(64) },
  },
}

describe('sandbox preparation proof', () => {
  it('accepts a prepared receipt tied to the sealed source identity', () => {
    expect(sandboxDrainReplySchema.parse({ ok: true, prepared: true, receipt }).receipt).toEqual(receipt)
  })
  it('rejects legacy success and unsealed or mismatched proof', () => {
    expect(sandboxDrainReplySchema.safeParse({ ok: true, paused: true }).success).toBe(false)
    for (const checkpoint of [
      { ...receipt.checkpoint, phase: ERuntimePhase.Running },
      { ...receipt.checkpoint, threadId: 'other' },
      { ...receipt.checkpoint, sandboxSessionId: 'other' },
    ]) expect(sandboxRotationReceiptSchema.safeParse({ ...receipt, checkpoint }).success).toBe(false)
  })
  it('keeps preparing intent distinct from permission to destroy', () => {
    const intent = { version: 1, preparing: true, threadId: 'root', sandboxSessionId: 'source-session', resumeParent: true }
    expect(sandboxRotationStateSchema.safeParse(intent).success).toBe(true)
    expect(sandboxRotationReceiptSchema.safeParse(intent).success).toBe(false)
  })
})
