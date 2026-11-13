import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EReportKind,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const child = toThreadId('thread-child')

const ended = (over: Record<string, unknown> = {}): EventDraft => ({
  type: 'agent-ended',
  agentId: child,
  agentType: 'explore',
  intent: 'audit',
  status: EAgentStatus.Finished,
  prose: 'found three issues',
  turns: 1,
  toolCalls: 2,
  ...over,
})

const reported = (over: Record<string, unknown> = {}): EventDraft => ({
  type: 'agent-reported',
  agentId: child,
  agentType: 'explore',
  intent: 'audit',
  prose: 'found three issues',
  kind: EReportKind.Done,
  ...over,
})

const kindsOf = (events: readonly Event[]) => durableEntries({ events }).map((entry) => entry.kind)

describe('one answer per finished agent', () => {
  it('renders the done report alone when the ending repeats it', () => {
    expect(kindsOf(log([ended(), reported()]))).toEqual([EEntryKind.AgentReported])
  })

  it('renders the ending when it says something the report does not', () => {
    expect(kindsOf(log([ended({ prose: 'found four issues' }), reported()]))).toEqual([
      EEntryKind.AgentEnded,
      EEntryKind.AgentReported,
    ])
  })

  it('keeps a failed ending beside a report that shares its words', () => {
    const failed = ended({ status: EAgentStatus.Failed, failureCause: 'boom' })
    expect(kindsOf(log([failed, reported()]))).toEqual([
      EEntryKind.AgentEnded,
      EEntryKind.AgentReported,
    ])
  })

  it('keeps a progress note, which is not the answer', () => {
    expect(kindsOf(log([ended(), reported({ kind: EReportKind.Progress })]))).toEqual([
      EEntryKind.AgentEnded,
      EEntryKind.AgentReported,
    ])
  })
})
