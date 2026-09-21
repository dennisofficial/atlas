import { EAgentStatus, toThreadId, type ProviderIdentity } from '@dltech/atlas-core'
import type { AgentSnapshot } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { crewTiersOf, deriveSidebar, withCrew } from '../sidebar-model'
import {
  subagentContextLabel,
  subagentElapsedMs,
  subagentRows,
  subagentStateLabel,
  type SidebarSubagent,
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
    expect(rows()[0]?.state).toBe('1m 4s')
  })
})

describe('what the narrow value column says about a child', () => {
  it('reads a working child as how long it has been going', () => {
    expect(labelOf()).toBe('1m 4s')
  })

  it('keeps what the window holds off the first line, which the second line carries', () => {
    expect(rows({ context: { tokens: 68_000, window: 200_000 } })[0]?.state).toBe('1m 4s')
  })

  it('keeps what the child is doing out of the column, however busy it is', () => {
    expect(rows({ lastTool: 'grep', toolCalls: 4 })[0]?.state).toBe('1m 4s')
  })

  it('says how long a blocked child has been stuck, which is the whole question', () => {
    expect(labelOf({ status: EAgentStatus.Blocked })).toBe('blocked · 1m 4s')
  })

  it('says nothing for a child that finished, keeping the word for endings that need it', () => {
    const ended = { endedAt: '2026-01-01T00:00:30.000Z' }

    expect(labelOf({ ...ended, status: EAgentStatus.Finished })).toBe('')
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
    expect(subagentContextLabel({ tokens: 68_000, window: 200_000 })).toBe('68.0k')
  })

  it('reads the tokens even when the window is unknown, now that no percentage needs it', () => {
    expect(subagentContextLabel({ tokens: 68_000, window: 0 })).toBe('68.0k')
  })

  it('carries the reading the supervisor took onto the row, from the snapshot itself', () => {
    const built = rows({ context: { tokens: 68_000, window: 200_000 } })

    expect(subagentContextLabel(built[0]?.context)).toBe('68.0k')
  })

  it('leaves a child nothing has measured unmeasured rather than measured at zero', () => {
    expect(rows()[0]?.context).toBe(undefined)
  })

  it('keeps a child measured as barely started apart from one nothing has measured', () => {
    expect(subagentContextLabel({ tokens: 400, window: 200_000 })).toBe('400')
    expect(subagentContextLabel(undefined)).toBe(null)
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

    expect(row?.model).toBe('claude-haiku-4-5')
    expect(subagentContextLabel(row?.context)).toBe('68.0k')
    expect(merged.spend).toBe(parent.spend)
    expect(Object.keys(merged).filter((field) => !(field in parent))).toEqual(['subagents'])
  })
})

describe('grouping the crew into tiers', () => {
  it('sorts a mixed roster into teammates and sub-agents by agentType', () => {
    const mixed = subagentRows({
      snapshots: [
        snapshot({ agentId: toThreadId('thr_a'), agentType: 'teammate' }),
        snapshot({ agentId: toThreadId('thr_b'), agentType: 'explore' }),
      ],
      now: NOW,
    })

    const tiers = crewTiersOf(mixed)

    expect(tiers.teammates.map((row) => row.id)).toEqual(['thr_a'])
    expect(tiers.subagents.map((row) => row.id)).toEqual(['thr_b'])
  })

  it('reads a row with no agentType as a sub-agent rather than dropping it', () => {
    const untyped: SidebarSubagent = {
      id: 'thr_untyped',
      name: 'vault audit',
      status: EAgentStatus.Running,
      startedAt: STARTED,
      endedAt: null,
      state: '1m 4s',
      model: null,
      selected: false,
    }

    const tiers = crewTiersOf([untyped])

    expect(tiers.teammates).toEqual([])
    expect(tiers.subagents).toEqual([untyped])
  })
})
