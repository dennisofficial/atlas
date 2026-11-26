import { describe, expect, it } from 'bun:test'

import { ESessionConnection } from '@dltech/atlas-client/stream'
import { EAgentStart, ETurnEndedBy, ETurnOutcome, type RecordEvent } from '@dltech/atlas-core'

import { backgroundWaitOf, waitElapsedOf } from '../background-wait'
import { eventSchema } from '../registered-plugins'

const SETTLED_AT = '2026-11-26T10:00:00.000Z'

const envelope = (args: { seq: number; depth?: number; at?: string }) => ({
  id: `evt_${args.seq}`,
  seq: args.seq,
  threadId: args.depth === undefined || args.depth === 0 ? 'thr_main' : 'thr_child',
  runId: 'run_1',
  depth: args.depth ?? 0,
  at: args.at ?? '2026-11-26T09:59:00.000Z',
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const shellStarted = (seq: number): RecordEvent =>
  eventSchema.parse({
    ...envelope({ seq }),
    type: 'background-shell-started',
    shellId: `sh_${seq}`,
    command: 'bun test',
  })

const agentSpawned = (seq: number): RecordEvent =>
  eventSchema.parse({
    ...envelope({ seq }),
    type: 'agent-spawned',
    agentId: `agent_${seq}`,
    agentType: 'builder',
    intent: 'build the fix',
    mode: EAgentStart.Fresh,
  })

const turnEnded = (args: { seq: number; depth?: number; at: string }): RecordEvent =>
  eventSchema.parse({
    ...envelope(args),
    type: 'turn-ended',
    turnId: `turn_${args.seq}`,
    outcome: ETurnOutcome.Completed,
    by: ETurnEndedBy.Agent,
  })

const liveSnapshot = (foldable: readonly RecordEvent[]) => ({
  foldable: [...foldable],
  connection: ESessionConnection.Live,
})

describe('the line a settled session shows while its background work runs', () => {
  it('counts the agents and shells the turn left running', () => {
    const wait = backgroundWaitOf({
      snapshot: liveSnapshot([
        agentSpawned(1),
        shellStarted(2),
        turnEnded({ seq: 3, at: SETTLED_AT }),
      ]),
      turnRunning: false,
    })

    expect(wait).toEqual({
      label: 'Waiting for 1 background agent and 1 shell to finish',
      settledAt: SETTLED_AT,
    })
  })

  it('shows nothing while the turn still runs, since the working row covers it', () => {
    const wait = backgroundWaitOf({
      snapshot: liveSnapshot([shellStarted(1)]),
      turnRunning: true,
    })

    expect(wait).toBeNull()
  })

  it('shows nothing when nothing is left running', () => {
    const wait = backgroundWaitOf({
      snapshot: liveSnapshot([turnEnded({ seq: 1, at: SETTLED_AT })]),
      turnRunning: false,
    })

    expect(wait).toBeNull()
  })

  it('shows nothing from a cached journal that is not live yet', () => {
    const wait = backgroundWaitOf({
      snapshot: { foldable: [shellStarted(1)], connection: ESessionConnection.CatchingUp },
      turnRunning: false,
    })

    expect(wait).toBeNull()
  })

  it('times the wait from the main turn ending, not from a child turn', () => {
    const wait = backgroundWaitOf({
      snapshot: liveSnapshot([
        shellStarted(1),
        turnEnded({ seq: 2, at: SETTLED_AT }),
        turnEnded({ seq: 3, depth: 1, at: '2026-11-26T10:05:00.000Z' }),
      ]),
      turnRunning: false,
    })

    expect(wait?.settledAt).toBe(SETTLED_AT)
  })
})

describe('how long the session has waited', () => {
  it('reads from the instant the turn settled, so a reopened thread keeps its count', () => {
    const elapsed = waitElapsedOf({
      wait: { label: 'Waiting for 1 shell to finish', settledAt: SETTLED_AT },
      held: Date.parse('2026-11-26T10:01:00.000Z'),
      now: Date.parse('2026-11-26T10:01:30.000Z'),
    })

    expect(elapsed).toBe('1m 30s')
  })

  it('falls back to when this screen first saw the wait', () => {
    const elapsed = waitElapsedOf({
      wait: { label: 'Waiting for 1 shell to finish', settledAt: undefined },
      held: Date.parse('2026-11-26T10:01:00.000Z'),
      now: Date.parse('2026-11-26T10:01:05.000Z'),
    })

    expect(elapsed).toBe('5s')
  })
})
