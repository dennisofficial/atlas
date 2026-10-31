import { describe, expect, it } from 'bun:test'

import {
  capabilitiesSchema,
  ECapability,
  EClientRequest,
  SERVE_CAPABILITIES,
  readActivityParamsSchema,
  readActivityReplySchema,
  type ReadActivityReply,
} from '../index'

const idle = {
  runtimeId: 'runtime-1',
  revision: 0,
  turnEpoch: 0,
  working: false,
  awaiting: null,
  observedOutcome: null,
}

describe('read-activity wire', () => {
  it('advertises the additive operation while accepting absent and unknown capabilities', () => {
    expect(String(EClientRequest.ReadActivity)).toBe('read-activity')
    expect(SERVE_CAPABILITIES).toContain(ECapability.ReadActivity)
    expect(capabilitiesSchema.parse([])).toEqual([])
    expect(capabilitiesSchema.parse(['future-op', 'read-activity'])).toEqual([
      ECapability.ReadActivity,
    ])
  })

  it('rejects empty runtime and outcome identities', () => {
    expect(readActivityReplySchema.safeParse({ ...idle, runtimeId: '' }).success).toBe(false)
    for (const identity of [
      { kind: 'run', runId: '' },
      { kind: 'driver-failure', runtimeId: '', revision: 0 },
    ]) {
      expect(
        readActivityReplySchema.safeParse({
          ...idle,
          observedOutcome: { identity, outcome: 'failed' },
        }).success,
      ).toBe(false)
    }
  })

  it('accepts genuine outcome identities and rejects invalid or extra nested facts', () => {
    const identities: NonNullable<ReadActivityReply['observedOutcome']>['identity'][] = [
      { kind: 'run', runId: 'run-1' },
      { kind: 'driver-failure', runtimeId: 'runtime-1', revision: 2 },
    ]
    for (const identity of identities) {
      const value: ReadActivityReply = { ...idle, observedOutcome: { identity, outcome: 'failed' } }
      expect(readActivityReplySchema.parse(value)).toEqual(value)
      expect(
        readActivityReplySchema.safeParse({
          ...value,
          observedOutcome: { ...value.observedOutcome, extra: true },
        }).success,
      ).toBe(false)
      expect(
        readActivityReplySchema.safeParse({
          ...value,
          observedOutcome: { identity: { ...identity, extra: true }, outcome: 'failed' },
        }).success,
      ).toBe(false)
    }
    for (const revision of [-1, 1.5]) {
      expect(readActivityReplySchema.safeParse({ ...idle, revision }).success).toBe(false)
      expect(readActivityReplySchema.safeParse({ ...idle, turnEpoch: revision }).success).toBe(
        false,
      )
      expect(
        readActivityReplySchema.safeParse({
          ...idle,
          observedOutcome: {
            identity: { kind: 'driver-failure', runtimeId: 'runtime-1', revision },
            outcome: 'failed',
          },
        }).success,
      ).toBe(false)
    }
    expect(readActivityReplySchema.safeParse({ ...idle, awaiting: 'unknown' }).success).toBe(false)
    expect(
      readActivityReplySchema.safeParse({
        ...idle,
        observedOutcome: {
          identity: { kind: 'run', runId: 'run-1' },
          outcome: 'paused',
        },
      }).success,
    ).toBe(false)
  })
  it('requires only the addressed thread and a complete strict snapshot', () => {
    expect(String(readActivityParamsSchema.parse({ threadId: 'root' }).threadId)).toBe('root')
    expect(readActivityParamsSchema.safeParse({ threadId: 'root', wake: true }).success).toBe(false)
    expect(readActivityParamsSchema.safeParse({ threadId: '' }).success).toBe(false)
    expect(readActivityReplySchema.parse(idle)).toEqual(idle)
    expect(readActivityReplySchema.safeParse({ ...idle, extra: true }).success).toBe(false)
    for (const field of Object.keys(idle)) {
      const incomplete = Object.fromEntries(Object.entries(idle).filter(([key]) => key !== field))
      expect(readActivityReplySchema.safeParse(incomplete).success).toBe(false)
    }
  })
})
