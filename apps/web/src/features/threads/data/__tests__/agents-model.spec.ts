import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  eventBodySchema,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'
import type { Event } from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { AgentSnapshotWire, RosterWire } from '@dltech/atlas-wire/web'

import { threadOf } from '@/features/shell/__tests__/fixtures'

import {
  activeAgentCount,
  agentRecordsOf,
  agentViewsOf,
  rosterKeyOf,
  teammatesOf,
} from '../agents-model'

const at = (seq: number) => `2026-10-26T10:00:${String(seq).padStart(2, '0')}.000Z`

const event = (seq: number, body: Record<string, unknown>): Event =>
  stampEvent({
    draft: eventBodySchema.parse(body),
    envelope: {
      id: toEventId(`evt_${seq}`),
      seq,
      threadId: toThreadId('lead'),
      runId: toRunId('run_1'),
      depth: 0,
      at: at(seq),
    },
  })

const spawned = (seq: number, agentId: string, agentType = 'explore') =>
  event(seq, {
    type: 'agent-spawned',
    agentId,
    agentType,
    intent: `work ${agentId}`,
    mode: 'fresh',
  })

const ended = (seq: number, agentId: string, extra: Record<string, unknown> = {}) =>
  event(seq, {
    type: 'agent-ended',
    agentId,
    agentType: 'explore',
    intent: `work ${agentId}`,
    status: EAgentStatus.Finished,
    prose: 'All done',
    turns: 2,
    toolCalls: 7,
    ...extra,
  })

const snapshot = (agentId: string, extra: Partial<AgentSnapshotWire> = {}): AgentSnapshotWire =>
  ({
    agentId,
    spawnedBy: 'lead',
    agentType: 'explore',
    intent: `work ${agentId}`,
    status: EAgentStatus.Running,
    turns: 1,
    toolCalls: 3,
    startedAt: at(1),
    ...extra,
  }) as AgentSnapshotWire

const rosterOf = (agents: AgentSnapshotWire[]): RosterWire => ({ shells: [], agents, services: [] })

describe('agentRecordsOf', () => {
  it('opens a running record at the spawn', () => {
    const [record] = agentRecordsOf([spawned(1, 'a')])
    expect(record).toMatchObject({ id: 'a', status: EAgentStatus.Running, spawnedAt: at(1) })
  })

  it('closes the record with the ending prose and tool call count', () => {
    const [record] = agentRecordsOf([spawned(1, 'a'), ended(5, 'a')])
    expect(record).toMatchObject({
      status: EAgentStatus.Finished,
      endedAt: at(5),
      prose: 'All done',
      toolCalls: 7,
    })
  })

  it('reopens a restarted agent and clears its ending', () => {
    const restarted = event(6, {
      type: 'agent-restarted',
      agentId: 'a',
      agentType: 'explore',
      intent: 'work a',
      via: 'resume',
    })
    const [record] = agentRecordsOf([spawned(1, 'a'), ended(5, 'a'), restarted])
    expect(record).toMatchObject({ status: EAgentStatus.Running, endedAt: undefined })
  })

  it('keeps a report apart from the ending prose', () => {
    const reported = event(3, {
      type: 'agent-reported',
      agentId: 'a',
      agentType: 'explore',
      intent: 'work a',
      prose: 'Halfway',
    })
    const [record] = agentRecordsOf([spawned(1, 'a'), reported])
    expect(record).toMatchObject({ reported: 'Halfway', prose: undefined })
  })

  it('opens a record for an ending whose spawn is not in the log', () => {
    const [record] = agentRecordsOf([ended(5, 'orphan')])
    expect(record).toMatchObject({ id: 'orphan', status: EAgentStatus.Finished })
  })
})

describe('agentRecordsOf with stamped notices', () => {
  const stamp = (stage: 'arrived' | 'delivered') => ({ notice: { id: 'n1', stage } })

  it('reads the ending from the arrival and ignores the delivery', () => {
    const [record] = agentRecordsOf([
      spawned(1, 'a'),
      ended(5, 'a', { ...stamp('arrived'), prose: 'arrived prose' }),
      ended(9, 'a', { ...stamp('delivered'), prose: 'delivered prose' }),
    ])
    expect(record).toMatchObject({
      status: EAgentStatus.Finished,
      endedAt: at(5),
      prose: 'arrived prose',
    })
  })

  it('does not let a late delivery close a restarted agent', () => {
    const restarted = event(6, {
      type: 'agent-restarted',
      agentId: 'a',
      agentType: 'explore',
      intent: 'work a',
      via: 'resume',
    })
    const [record] = agentRecordsOf([
      spawned(1, 'a'),
      ended(5, 'a', stamp('arrived')),
      restarted,
      ended(9, 'a', stamp('delivered')),
    ])
    expect(record).toMatchObject({ status: EAgentStatus.Running, endedAt: undefined })
  })
})

describe('agentViewsOf', () => {
  it('takes live status and last tool from the roster', () => {
    const records = agentRecordsOf([spawned(1, 'a')])
    const roster = rosterOf([
      snapshot('a', { lastTool: 'read', model: { id: 'p', modelId: 'sonnet' } }),
    ])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster })
    expect(view).toMatchObject({
      display: EAgentDisplay.Running,
      live: true,
      latestCall: 'Using read',
      model: 'sonnet',
    })
  })

  it('says Starting before the first tool', () => {
    const records = agentRecordsOf([spawned(1, 'a')])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster: rosterOf([snapshot('a')]) })
    expect(view?.latestCall).toBe('Starting')
  })

  it('lets the durable ending win over a stale roster entry', () => {
    const records = agentRecordsOf([spawned(1, 'a'), ended(5, 'a')])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster: rosterOf([snapshot('a')]) })
    expect(view).toMatchObject({ display: EAgentDisplay.Done, live: false, report: 'All done' })
    expect(view?.endedAt).toBe(Date.parse(at(5)))
  })

  it('shows an unfinished agent as paused when no roster is connected', () => {
    const records = agentRecordsOf([spawned(1, 'a')])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster: null })
    expect(view).toMatchObject({ display: EAgentDisplay.Paused, latestCall: undefined })
  })

  it('maps a blocked agent to needs approval', () => {
    const records = agentRecordsOf([spawned(1, 'a')])
    const roster = rosterOf([snapshot('a', { status: EAgentStatus.Blocked })])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster })
    expect(view?.display).toBe(EAgentDisplay.NeedsApproval)
  })

  it('reports a failure with its cause', () => {
    const records = agentRecordsOf([
      spawned(1, 'a'),
      ended(5, 'a', { status: EAgentStatus.Failed, failureCause: 'rate limited', prose: '' }),
    ])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster: null })
    expect(view).toMatchObject({ display: EAgentDisplay.Failed, errorText: 'rate limited' })
  })

  it('falls back to a generic failure message', () => {
    const records = agentRecordsOf([
      spawned(1, 'a'),
      ended(5, 'a', { status: EAgentStatus.Failed, prose: '' }),
    ])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster: null })
    expect(view?.errorText).toBe('The run failed.')
  })

  it('adds roster agents the log has not shown yet, only for this thread', () => {
    const roster = rosterOf([
      snapshot('fresh'),
      snapshot('other', { spawnedBy: 'elsewhere' as never }),
    ])
    const views = agentViewsOf({ threadId: 'lead', records: [], roster })
    expect(views.map((view) => view.id)).toEqual(['fresh'])
  })

  it('flags teammate agents', () => {
    const records = agentRecordsOf([spawned(1, 'm', 'teammate')])
    const [view] = agentViewsOf({ threadId: 'lead', records, roster: null })
    expect(view?.teammate).toBe(true)
  })
})

describe('activeAgentCount', () => {
  it('counts running and approval-waiting sub-agents, not teammates or finished ones', () => {
    const records = agentRecordsOf([
      spawned(1, 'a'),
      spawned(2, 'b'),
      spawned(3, 'c'),
      spawned(4, 'm', 'teammate'),
      ended(9, 'c'),
    ])
    const roster = rosterOf([
      snapshot('a'),
      snapshot('b', { status: EAgentStatus.Blocked }),
      snapshot('m', { agentType: 'teammate' }),
    ])
    expect(activeAgentCount(agentViewsOf({ threadId: 'lead', records, roster }))).toBe(2)
  })
})

describe('rosterKeyOf', () => {
  it('changes when an owned agent changes status and ignores others', () => {
    const running = rosterOf([snapshot('a')])
    const done = rosterOf([snapshot('a', { status: EAgentStatus.Finished })])
    const foreign = rosterOf([snapshot('a'), snapshot('z', { spawnedBy: 'elsewhere' as never })])
    expect(rosterKeyOf({ threadId: 'lead', roster: running })).not.toBe(
      rosterKeyOf({ threadId: 'lead', roster: done }),
    )
    expect(rosterKeyOf({ threadId: 'lead', roster: foreign })).toBe(
      rosterKeyOf({ threadId: 'lead', roster: running }),
    )
    expect(rosterKeyOf({ threadId: 'lead', roster: null })).toBe('')
  })
})

describe('teammatesOf', () => {
  it('lists only teammate threads, titled, with a display from the matching agent', () => {
    const records = agentRecordsOf([spawned(1, 'm', 'teammate')])
    const views = agentViewsOf({
      threadId: 'lead',
      records,
      roster: rosterOf([snapshot('m', { agentType: 'teammate' })]),
    })
    const result = teammatesOf({
      spawned: [
        threadOf({ id: 'm', title: 'Build tabs', agent: { spawnedBy: 'lead', type: 'teammate' } }),
        threadOf({ id: 'x', title: 'Explorer', agent: { spawnedBy: 'lead', type: 'explore' } }),
        threadOf({ id: 'n', agent: { spawnedBy: 'lead', type: 'teammate' } }),
      ],
      views,
    })
    expect(result).toEqual([
      { id: 'm', title: 'Build tabs', display: EAgentDisplay.Running },
      { id: 'n', title: 'Untitled thread', display: EAgentDisplay.Done },
    ])
  })
})
