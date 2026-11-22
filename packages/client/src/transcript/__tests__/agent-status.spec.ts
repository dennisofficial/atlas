import { describe, expect, it } from 'bun:test'
import { v2EventSchema } from '@dltech/atlas-core'

import { agentLabelOf, agentOf, agentsOf } from '../agent-status'

const envelope = (args: { seq: number; threadId: string }) => ({
  id: `evt_${args.seq}`,
  seq: args.seq,
  threadId: args.threadId,
  runId: 'run_1',
  depth: 0,
  at: `2026-11-22T10:00:0${args.seq}.000Z`,
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const eventsOf = (raw: readonly unknown[]) => raw.map((event) => v2EventSchema.parse(event))

const spawned = {
  ...envelope({ seq: 1, threadId: 'thr_main' }),
  type: 'agent-spawned',
  agentId: 'thr_child',
  agentType: 'builder',
  intent: 'Fix the failing test',
  mode: 'fresh',
}

const ended = {
  ...envelope({ seq: 2, threadId: 'thr_main' }),
  type: 'agent-ended',
  agentId: 'thr_child',
  agentType: 'builder',
  intent: 'Fix the failing test',
  status: 'finished',
  prose: 'Done.',
  turns: 2,
  toolCalls: 3,
}

describe('agentsOf', () => {
  it('runs from the spawn and stops at the end', () => {
    expect(agentsOf({ events: eventsOf([spawned]) }).get('thr_child')?.running).toBe(true)
    expect(agentsOf({ events: eventsOf([spawned, ended]) }).get('thr_child')?.running).toBe(false)
  })

  it('runs again after a restart', () => {
    const restarted = {
      ...envelope({ seq: 3, threadId: 'thr_main' }),
      type: 'agent-restarted',
      agentId: 'thr_child',
      agentType: 'builder',
      intent: 'Fix the failing test',
      via: 'resume',
    }
    const agents = agentsOf({ events: eventsOf([spawned, ended, restarted]) })
    expect(agents.get('thr_child')?.running).toBe(true)
  })

  it('keeps the spawned type and intent for the title', () => {
    const agent = agentsOf({ events: eventsOf([spawned, ended]) }).get('thr_child')
    expect(agentLabelOf(agent)).toBe('Fix the failing test')
  })

  it('reports nothing for an agent the thread never spawned', () => {
    expect(agentsOf({ events: eventsOf([spawned]) }).get('thr_other')).toBeUndefined()
    expect(agentLabelOf(undefined)).toBe('Sub-agent')
  })

  it('finds a nested agent in the events of its own parent thread', () => {
    const nested = {
      ...envelope({ seq: 4, threadId: 'thr_child' }),
      type: 'agent-spawned',
      agentId: 'thr_grandchild',
      agentType: 'explore',
      intent: 'Find the caller',
      mode: 'fresh',
    }
    const parentEvents = eventsOf([nested])
    const onMainThread = agentsOf({ events: eventsOf([spawned]) })

    expect(onMainThread.get('thr_grandchild')).toBeUndefined()
    expect(agentOf({ events: parentEvents, agentId: 'thr_grandchild' })).toMatchObject({
      agentType: 'explore',
      running: true,
    })
  })
})
