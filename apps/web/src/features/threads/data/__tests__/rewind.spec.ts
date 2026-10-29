import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  ECompactionAnchor,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { EAgentStatus, type RosterWire } from '@dltech/atlas-wire/web'

import { planRewind, userRewindPoints } from '../rewind'

const eventsFrom = (drafts: readonly EventDraft[], firstSeq = 0): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt_${firstSeq + index}`),
      seq: firstSeq + index,
      threadId: toThreadId('thr_1'),
      runId: toRunId('run_1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 9, 28, 10, 0, index)).toISOString(),
    })),
  })

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: toThreadId('thr_child'),
  agentType: 'explore',
  intent: 'vault audit',
  mode: EAgentStart.Fresh,
}

const rosterWith = (status: EAgentStatus): RosterWire => ({
  shells: [],
  services: [],
  agents: [
    {
      agentId: toThreadId('thr_child'),
      spawnedBy: toThreadId('thr_1'),
      agentType: 'explore',
      intent: 'vault audit',
      status,
      turns: 1,
      toolCalls: 0,
      lastTool: undefined,
      startedAt: '2026-10-28T10:00:00.000Z',
      endedAt: undefined,
    },
  ],
})

describe('planRewind', () => {
  it('plans a rewind to before a user message with no kills', () => {
    const events = eventsFrom([said('one'), replied('two'), said('three')])

    expect(planRewind({ events, toSeq: 1, roster: null })).toEqual({
      kind: 'ok',
      toSeq: 1,
      cuts: [],
      cutAgents: [],
      kills: [],
    })
  })

  it('carries the wire cuts and cut agent ids the apply needs', () => {
    const events = eventsFrom([said('one'), replied('two'), said('three'), spawned])

    const plan = planRewind({ events, toSeq: 1, roster: null })

    expect(plan).toMatchObject({
      kind: 'ok',
      cuts: [
        {
          kind: 'agent',
          agentId: 'thr_child',
          agentType: 'explore',
          intent: 'vault audit',
        },
      ],
      cutAgents: ['thr_child'],
    })
  })

  it('refuses a target below the compaction floor with the core reason', () => {
    const events = eventsFrom(
      [
        {
          type: 'history-compacted',
          anchor: ECompactionAnchor.Prefix,
          fromSeq: 1,
          throughSeq: 1,
          summary: 'the first exchange',
          replaced: 1,
        },
        said('two'),
        replied('three'),
      ],
      1,
    )

    const plan = planRewind({ events, toSeq: 0, roster: null })

    expect(plan.kind).toBe('refused')
    if (plan.kind !== 'refused') throw new Error('expected a refusal')
    expect(plan.reason).toContain('compacted')
  })

  it('marks a spawned agent above the target as a kill, running per the roster', () => {
    const events = eventsFrom([said('one'), replied('two'), said('three'), spawned])

    const plan = planRewind({
      events,
      toSeq: 1,
      roster: rosterWith(EAgentStatus.Running),
    })

    if (plan.kind !== 'ok') throw new Error('expected a plan')
    expect(plan.kills).toHaveLength(1)
    expect(plan.kills[0]).toMatchObject({ kind: 'agent', running: true })
    expect(plan.kills[0]?.label).toContain('explore')
    expect(plan.kills[0]?.label).toContain('vault audit')
  })

  it('falls back to running false when the roster is absent', () => {
    const events = eventsFrom([said('one'), replied('two'), said('three'), spawned])

    const plan = planRewind({ events, toSeq: 1, roster: null })

    if (plan.kind !== 'ok') throw new Error('expected a plan')
    expect(plan.kills).toEqual([{ kind: 'agent', label: 'explore "vault audit"', running: false }])
  })
})

describe('userRewindPoints', () => {
  it('maps user-said events to rewind points one seq earlier', () => {
    const events = eventsFrom([said('one'), replied('two'), said('three')])

    expect(userRewindPoints(events)).toEqual(new Map([['evt_2', 1]]))
  })
})
