import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EReportKind, toThreadId, type Event } from '@dltech/atlas-core'

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

const quiet = (over: Record<string, unknown> = {}) =>
  ending({ relayed: false, waitingOn: 'CI on #1366', ...over })

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

describe('quiet endings in the transcript', () => {
  it('fold into one row carrying the latest turns and what the agent waits on', () => {
    const rows = ended(
      log([
        quiet({ turns: 171 }),
        quiet({ turns: 173, waitingOn: 'CI on #1367' }),
        quiet({ turns: 174, prose: 'Latest prose.' }),
      ]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe(
      'Teammate Web thread provisioning paused · waiting on CI on #1366 · 174 turns',
    )
    expect(rows[0]?.key).toBe('event-1')
    expect(rows[0]?.report).toBe('Latest prose.')
    expect(rows[0]?.quiet).toBe(true)
    expect(rows[0]?.text).not.toContain('finished')
  })

  it('leaves out the wait when the ending did not name one', () => {
    const [row] = ended(log([quiet({ waitingOn: undefined, turns: 1 })]))

    expect(row?.text).toBe('Teammate Web thread provisioning paused · 1 turn')
  })

  it('names a sub-agent as a sub-agent', () => {
    const [row] = ended(log([quiet({ agentType: 'explore' })]))

    expect(row?.text.startsWith('Sub-agent ')).toBe(true)
  })

  it('render nothing once a relayed ending from the same agent follows', () => {
    const rows = ended(log([quiet(), quiet({ turns: 173 }), ending({ turns: 180 })]))

    expect(rows).toHaveLength(1)
    expect(rows[0]?.quiet).not.toBe(true)
    expect(rows[0]?.text).toContain('finished after 180 turns')
  })

  it('render nothing once a waking report from the same agent follows', () => {
    const events = log([quiet(), report({ kind: EReportKind.Done })])

    expect(ended(events)).toHaveLength(0)
    expect(reported(events)).toHaveLength(1)
  })

  it('stay a row when only a progress report follows', () => {
    expect(ended(log([quiet(), report({ kind: EReportKind.Progress })]))).toHaveLength(1)
  })

  it('keep one row per agent', () => {
    const other = toThreadId('thread-other')
    const rows = ended(
      log([quiet(), quiet({ agentId: other, intent: 'Review the diff' }), quiet()]),
    )

    expect(rows.map((row) => row.agentId)).toEqual([teammate, other])
  })

  it('keep a prose fold', () => {
    expect(isExpandable(ended(log([quiet()]))[0] as AgentEndedEntry)).toBe(true)
  })

  it('leave an ending without the fields exactly as it was', () => {
    const [row] = ended(log([ending({ turns: 3, toolCalls: 12 })]))

    expect(row?.text).toBe(
      'Teammate Web thread provisioning finished after 3 turns and 12 tool calls',
    )
    expect(row?.quiet).not.toBe(true)
  })

  it('still marks a failed relayed ending as failed', () => {
    const [row] = ended(log([ending({ status: EAgentStatus.Failed, relayed: true })]))

    expect(row?.failed).toBe(true)
  })
})

describe('typed reports in the transcript', () => {
  it('reads a legacy report as before', () => {
    expect(reported(log([report()]))[0]?.text).toBe('Teammate Web thread provisioning reported')
  })

  it('reads a progress report as progress', () => {
    const [row] = reported(log([report({ kind: EReportKind.Progress })]))

    expect(row?.text).toBe('Teammate Web thread provisioning reported progress')
    expect(row?.reportKind).toBe(EReportKind.Progress)
  })

  it('says when a teammate is blocked or needs a decision', () => {
    expect(reported(log([report({ kind: EReportKind.Blocked })]))[0]?.text).toContain('blocked')
    expect(reported(log([report({ kind: EReportKind.NeedsDecision })]))[0]?.text).toContain(
      'needs a decision',
    )
  })

  it('reads a done report as done', () => {
    expect(reported(log([report({ kind: EReportKind.Done })]))[0]?.text).toContain('reported done')
  })
})
