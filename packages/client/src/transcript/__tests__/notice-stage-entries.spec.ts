import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EServiceStatus, toThreadId, type Event } from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const stamp = (id: string, stage: 'arrived' | 'delivered') => ({
  notice: { id, stage },
})

const agentEnded = (over: Record<string, unknown> = {}) => ({
  type: 'agent-ended' as const,
  agentId: toThreadId('thread-child'),
  agentType: 'explore',
  intent: 'audit',
  status: EAgentStatus.Finished,
  prose: 'found it',
  turns: 1,
  toolCalls: 2,
  ...over,
})

const serviceEnded = (over: Record<string, unknown> = {}) => ({
  type: 'service-ended' as const,
  serviceId: 'svc_1',
  command: 'bun run dev',
  status: EServiceStatus.Exited,
  exitCode: 0,
  tail: 'bye',
  ...over,
})

const kindsOf = (events: readonly Event[]) => durableEntries({ events }).map((entry) => entry.kind)

describe('transcript events for notices stamped at arrival and delivery', () => {
  it('renders an arrived and delivered pair once, at the delivered position', () => {
    const events = log([
      { type: 'user-said', text: 'go' },
      agentEnded(stamp('n1', 'arrived')),
      {
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'still working' }],
      },
      agentEnded(stamp('n1', 'delivered')),
    ])

    const entries = durableEntries({ events })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.ModelSaid,
      EEntryKind.AgentEnded,
    ])
    expect(entries[2]?.key).toBe(events[3]?.id)
  })

  it('renders a service pair once', () => {
    const events = log([
      serviceEnded(stamp('n2', 'arrived')),
      serviceEnded(stamp('n2', 'delivered')),
    ])

    expect(kindsOf(events)).toEqual([EEntryKind.ServiceEnded])
  })

  it('shows nothing for an arrival still owed', () => {
    expect(kindsOf(log([agentEnded(stamp('n3', 'arrived'))]))).toEqual([])
  })

  it('renders legacy rows exactly as before', () => {
    const events = log([agentEnded(), serviceEnded()])

    expect(kindsOf(events)).toEqual([EEntryKind.AgentEnded, EEntryKind.ServiceEnded])
  })
})
