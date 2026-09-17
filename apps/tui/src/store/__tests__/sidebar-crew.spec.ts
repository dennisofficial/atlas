import { EAgentStatus, toThreadId, type ProviderIdentity } from '@dltech/atlas-core'
import type { AgentSnapshot } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { deriveSidebar, withCrew } from '../sidebar-model'
import {
  subagentContextLabel,
  subagentElapsedMs,
  subagentFigures,
  subagentRows,
  subagentStateLabel,
  type SubagentReadout,
} from '../subagent-row'
import { IDLE_TURN } from '../../ui/turn-clock'
import { log } from './fixture'

const PARENT = toThreadId('thr_parent')

const CHILD = toThreadId('thr_child')

const STARTED = '2026-01-01T00:00:00.000Z'

const NOW = Date.parse('2026-01-01T00:01:04.000Z')

const HAIKU: ProviderIdentity = { id: 'anthropic', modelId: 'claude-haiku-4-5' }

const snapshot = (over: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  agentId: CHILD,
  spawnedBy: PARENT,
  agentType: 'explore',
  intent: 'vault audit',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: STARTED,
  endedAt: undefined,
  ...over,
})

const rows = (over: Partial<AgentSnapshot> = {}) =>
  subagentRows({ snapshots: [snapshot(over)], now: NOW })

const readout = (over: Partial<SubagentReadout> = {}): SubagentReadout => ({
  status: EAgentStatus.Running,
  lastTool: null,
  startedAt: STARTED,
  endedAt: null,
  ...over,
})

const labelOf = (over: Partial<SubagentReadout> = {}): string =>
  subagentStateLabel({ subagent: readout(over), now: NOW })

describe('a child row is derived from the child', () => {
  it('takes no turn count from the conversation it is listed beside', () => {
    const parent = deriveSidebar({
      events: log([
        { type: 'user-said', text: 'audit the vault' },
        { type: 'user-said', text: 'and the key file' },
      ]),
      turn: IDLE_TURN,
      name: 'the parent conversation',
    })

    const merged = withCrew({ model: parent, subagents: rows() })

    expect(merged.turnCount).toBe(2)
    expect(merged.subagents?.[0]?.name).toBe('vault audit')
  })

  it('names an untitled child by its type rather than borrowing a title', () => {
    expect(rows({ intent: '   ' })[0]?.name).toBe('explore')
  })

  it('folds an intent written across lines onto one row', () => {
    expect(rows({ intent: 'vault\n  audit' })[0]?.name).toBe('vault audit')
  })

  it('carries the reading the row renders rather than making the view assemble it', () => {
    expect(rows({ lastTool: 'grep', toolCalls: 4 })[0]?.state).toBe('grep · 1m 4s')
  })
})

describe('what the narrow value column says about a child', () => {
  it('reads a working child as the tool it is on and how long it has been going', () => {
    expect(labelOf({ lastTool: 'bash' })).toBe('bash · 1m 4s')
  })

  it('still gives a working child that has called nothing yet its elapsed time', () => {
    expect(labelOf()).toBe('1m 4s')
  })

  it('says how long a blocked child has been stuck, which is the whole question', () => {
    expect(labelOf({ status: EAgentStatus.Blocked, lastTool: 'bash' })).toBe('blocked · 1m 4s')
  })

  it('reads a settled child as its outcome and nothing else', () => {
    const ended = { endedAt: '2026-01-01T00:00:30.000Z' }

    expect(labelOf({ ...ended, status: EAgentStatus.Finished })).toBe('done')
    expect(labelOf({ ...ended, status: EAgentStatus.Failed })).toBe('failed')
    expect(labelOf({ ...ended, status: EAgentStatus.Stopped })).toBe('stopped')
  })

  it('stops the clock of a child that ended rather than running it to now', () => {
    const stopped = readout({
      status: EAgentStatus.Finished,
      endedAt: '2026-01-01T00:00:30.000Z',
    })

    expect(subagentElapsedMs({ subagent: stopped, now: NOW })).toBe(30_000)
  })

  it('never reads earlier than the child started, so elapsed cannot go negative', () => {
    expect(subagentElapsedMs({ subagent: readout(), now: Date.parse(STARTED) - 5_000 })).toBe(0)
  })

  it('says nothing about time it cannot read', () => {
    expect(subagentElapsedMs({ subagent: readout({ startedAt: 'not a stamp' }), now: NOW })).toBe(
      null,
    )
  })
})

describe('which model the child runs', () => {
  it('names the model by the label the catalogue gives it', () => {
    const built = subagentRows({
      snapshots: [snapshot({ model: HAIKU })],
      now: NOW,
      modelLabel: () => 'Claude Haiku 4.5',
    })

    expect(built[0]?.model).toBe('Claude Haiku 4.5')
  })

  it('falls back to the model id when nothing labels the model', () => {
    expect(rows({ model: HAIKU })[0]?.model).toBe('claude-haiku-4-5')
  })

  it('leaves a child this process never observed unmodeled rather than guessing', () => {
    expect(rows()[0]?.model).toBe(null)
  })
})

describe("how full the child's own window is", () => {
  it('reads the child against the window the child runs, never the window the parent runs', () => {
    expect(subagentContextLabel({ tokens: 68_000, window: 200_000 })).toBe('ctx 34%')
  })

  it('says nothing when the window is unknown rather than reading the child as empty', () => {
    expect(subagentContextLabel({ tokens: 68_000, window: 0 })).toBe(null)
  })

  it('carries the reading the supervisor took onto the row, from the snapshot itself', () => {
    const built = rows({ context: { tokens: 68_000, window: 200_000 } })

    expect(subagentContextLabel(built[0]?.context)).toBe('ctx 34%')
  })

  it('leaves a child nothing has measured unmeasured rather than measured at zero', () => {
    expect(rows()[0]?.context).toBe(undefined)
  })

  it('keeps a child measured as barely started apart from one nothing has measured', () => {
    expect(subagentContextLabel({ tokens: 400, window: 200_000 })).toBe('ctx 0%')
    expect(subagentContextLabel(undefined)).toBe(null)
  })
})

describe('the second line a child row hangs off its right edge', () => {
  it('writes the model first and how full the window has got to the right of it', () => {
    expect(
      subagentFigures({ model: 'Claude Haiku 4.5', context: { tokens: 68_000, window: 200_000 } }),
    ).toBe('Claude Haiku 4.5  ctx 34%')
  })

  it('writes the window reading alone for a child whose model was never observed', () => {
    expect(subagentFigures({ model: null, context: { tokens: 68_000, window: 200_000 } })).toBe(
      'ctx 34%',
    )
  })

  it('writes the model alone when nothing has measured the child yet', () => {
    expect(subagentFigures({ model: 'Claude Haiku 4.5', context: undefined })).toBe(
      'Claude Haiku 4.5',
    )
  })

  it('spends no row height on a child neither reading has reached', () => {
    expect(subagentFigures({ model: null, context: undefined })).toBe(null)
  })
})

describe('merging the crew into a sidebar', () => {
  it('leaves a sidebar untouched when there is no crew to add', () => {
    const parent = deriveSidebar({ events: [], turn: IDLE_TURN, name: null })

    expect(withCrew({ model: parent, subagents: [] })).toBe(parent)
  })

  it('carries no context reading of the child onto the model the meter reads', () => {
    const parent = deriveSidebar({ events: [], turn: IDLE_TURN, name: null })
    const merged = withCrew({ model: parent, subagents: rows({ turns: 9 }) })

    expect(merged.spend).toBe(parent.spend)
  })

  /**
   * The child's own window is the reading most tempting to pool with the parent's: a child may run
   * a different model, so its window is not a share of the parent's and cannot be pooled with it.
   */
  it('keeps a measured child off the meter the parent reads', () => {
    const parent = deriveSidebar({ events: [], turn: IDLE_TURN, name: null })
    const measured = subagentRows({
      snapshots: [snapshot({ context: { tokens: 68_000, window: 200_000 }, model: HAIKU })],
      now: NOW,
    })
    const merged = withCrew({ model: parent, subagents: measured })
    const row = merged.subagents?.[0]

    expect(row === undefined ? null : subagentFigures(row)).toBe('claude-haiku-4-5  ctx 34%')
    expect(merged.spend).toBe(parent.spend)
    expect(Object.keys(merged).filter((field) => !(field in parent))).toEqual(['subagents'])
  })
})
