import { describe, expect, it } from 'bun:test'

import { v2EventSchema, type V2Event } from '@dltech/atlas-core'

import { turnStartedAtOf } from '../turn-start'

const HASH = 'a'.repeat(64)

const eventOf = (args: { seq: number; at: string; depth?: number; body: object }): V2Event =>
  v2EventSchema.parse({
    ...args.body,
    id: `evt_${args.seq}`,
    seq: args.seq,
    threadId: 'thr_1',
    runId: 'run_1',
    depth: args.depth ?? 0,
    at: args.at,
    epoch: 1,
    prevHash: HASH,
  })

const started = (args: { seq: number; turnId: string; at: string; depth?: number }): V2Event =>
  eventOf({
    seq: args.seq,
    at: args.at,
    ...(args.depth === undefined ? {} : { depth: args.depth }),
    body: { type: 'turn-started', turnId: args.turnId, cause: 'input' },
  })

const ended = (args: { seq: number; turnId: string; at: string; depth?: number }): V2Event =>
  eventOf({
    seq: args.seq,
    at: args.at,
    ...(args.depth === undefined ? {} : { depth: args.depth }),
    body: { type: 'turn-ended', turnId: args.turnId, outcome: 'completed', by: 'agent' },
  })

describe('turnStartedAtOf', () => {
  it('reads the start of the turn still open', () => {
    const events = [
      started({ seq: 1, turnId: 't1', at: '2026-11-22T14:20:00.000Z' }),
      ended({ seq: 2, turnId: 't1', at: '2026-11-22T14:21:00.000Z' }),
      started({ seq: 3, turnId: 't2', at: '2026-11-22T19:14:00.000Z' }),
    ]

    expect(turnStartedAtOf(events)).toBe('2026-11-22T19:14:00.000Z')
  })

  it('says nothing once every turn has ended', () => {
    const events = [
      started({ seq: 1, turnId: 't1', at: '2026-11-22T14:20:00.000Z' }),
      ended({ seq: 2, turnId: 't1', at: '2026-11-22T14:21:00.000Z' }),
    ]

    expect(turnStartedAtOf(events)).toBeUndefined()
  })

  it('ignores a sub-agent turn that outlasts the main one', () => {
    const events = [
      started({ seq: 1, turnId: 'main', at: '2026-11-22T19:14:00.000Z' }),
      ended({ seq: 2, turnId: 'main', at: '2026-11-22T19:15:00.000Z' }),
      started({ seq: 3, turnId: 'sub', at: '2026-11-22T19:16:00.000Z', depth: 1 }),
    ]

    expect(turnStartedAtOf(events)).toBeUndefined()
  })

  it('says nothing before any turn has started', () => {
    expect(turnStartedAtOf([])).toBeUndefined()
  })
})
