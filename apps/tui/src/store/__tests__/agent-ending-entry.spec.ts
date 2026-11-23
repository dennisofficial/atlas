import { describe, expect, it } from 'bun:test'

import { EAgentStatus, toThreadId, type Event } from '@dltech/atlas-core'

import {
  durableEntries,
  EEntryKind,
  type AgentEndedEntry,
  type AgentReportedEntry,
} from '@dltech/atlas-client/transcript'
import { isExpandable } from '../expandable'
import { log } from '@dltech/atlas-client/transcript-fixture'

const teammate = toThreadId('thread-teammate')

const ending = (over: Record<string, unknown> = {}) => ({
  type: 'agent-ended' as const,
  agentId: teammate,
  agentType: 'teammate',
  intent: 'Web thread provisioning',
  status: EAgentStatus.Finished,
  prose: 'Waiting for CI.',
  turns: 171,
  toolCalls: 40,
  ...over,
})

const bookkeeping = (over: Record<string, unknown> = {}) => ending({ relayed: false, ...over })

const report = (over: Record<string, unknown> = {}) => ({
  type: 'agent-reported' as const,
  agentId: teammate,
  agentType: 'teammate',
  intent: 'Web thread provisioning',
  prose: 'Still going.',
  ...over,
})

const ended = (events: readonly Event[]): AgentEndedEntry[] =>
  durableEntries({ events }).filter(
    (entry): entry is AgentEndedEntry => entry.kind === EEntryKind.AgentEnded,
  )

const reported = (events: readonly Event[]): AgentReportedEntry[] =>
  durableEntries({ events }).filter(
    (entry): entry is AgentReportedEntry => entry.kind === EEntryKind.AgentReported,
  )

describe('agent endings in the transcript', () => {
  it('render nothing for a bookkeeping ending, old waiting reasons included', () => {
    const events = log([bookkeeping(), bookkeeping({ waitingOn: 'CI on #1366', turns: 173 })])

    expect(ended(events)).toHaveLength(0)
  })

  it('show a teammate report alongside its silent bookkeeping ending', () => {
    const events = log([bookkeeping(), report()])

    expect(ended(events)).toHaveLength(0)
    expect(reported(events)).toHaveLength(1)
  })

  it('render a relayed ending as one row', () => {
    const [row] = ended(log([ending({ turns: 3, toolCalls: 12 })]))

    expect(row?.text).toBe(
      'Teammate Web thread provisioning finished after 3 turns and 12 tool calls',
    )
  })

  it('name a sub-agent as a sub-agent', () => {
    const [row] = ended(log([ending({ agentType: 'explore' })]))

    expect(row?.text.startsWith('Sub-agent ')).toBe(true)
  })

  it('keep one row per relayed ending', () => {
    const other = toThreadId('thread-other')
    const rows = ended(log([ending(), ending({ agentId: other, intent: 'Review the diff' })]))

    expect(rows.map((row) => row.agentId)).toEqual([teammate, other])
  })

  it('keep a prose fold', () => {
    expect(isExpandable(ended(log([ending()]))[0] as AgentEndedEntry)).toBe(true)
  })

  it('still marks a failed relayed ending as failed', () => {
    const [row] = ended(log([ending({ status: EAgentStatus.Failed, relayed: true })]))

    expect(row?.failed).toBe(true)
  })
})

describe('reports in the transcript', () => {
  it('reads a report as one row, with no kind', () => {
    const [row] = reported(log([report()]))

    expect(row?.text).toBe('Teammate Web thread provisioning reported')
  })

  it('keeps the prose of the report expandable', () => {
    expect(isExpandable(reported(log([report()]))[0] as AgentReportedEntry)).toBe(true)
  })
})
