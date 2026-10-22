import { describe, expect, it } from 'bun:test'

import { EReportKind } from '../../agents/report'
import { EAgentStatus } from '../../agents/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toEventId, toRunId, toThreadId } from '../ids'
import { loopWatchState } from '../loop-watch'
import { stampDrafts } from '../stamp'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const said = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const ended = (over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {}): EventDraft => ({
  type: 'agent-ended',
  agentId: toThreadId('brn-child'),
  agentType: 'teammate',
  intent: 'port the sidebar',
  status: EAgentStatus.Finished,
  prose: 'Done. Draft PR #598 opened.',
  turns: 3,
  toolCalls: 7,
  ...over,
})

const reported = (kind?: EReportKind): EventDraft => ({
  type: 'agent-reported',
  agentId: toThreadId('brn-child'),
  agentType: 'teammate',
  intent: 'port the sidebar',
  prose: 'CI is still running',
  kind,
})

const stateAround = (event: EventDraft): string =>
  loopWatchState({
    events: eventsFrom([
      { type: 'user-said', text: 'ship it' },
      said('one'),
      said('two'),
      event,
      said('three'),
      said('four'),
    ]),
  }) ?? ''

describe('the loop watchdog reading agent events', () => {
  it('renders a quiet ending as a pause naming what it waits on', () => {
    const state = stateAround(ended({ relayed: false, waitingOn: 'CI on #1366' }))

    expect(state).toContain('sub-agent "port the sidebar" paused (waiting on CI on #1366)')
    expect(state).not.toContain('Draft PR #598')
  })

  it('renders a quiet ending with no waitingOn as a bare pause', () => {
    const state = stateAround(ended({ relayed: false }))

    expect(state).toContain('sub-agent "port the sidebar" paused')
    expect(state).not.toContain('waiting on')
  })

  it('renders a relayed ending as before', () => {
    const state = stateAround(ended())

    expect(state).toContain(
      'sub-agent "port the sidebar" (teammate) finished: Done. Draft PR #598 opened.',
    )
  })

  it('renders a report with its kind', () => {
    expect(stateAround(reported(EReportKind.Progress))).toContain(
      'teammate "port the sidebar" reported (progress): CI is still running',
    )
  })

  it('renders a legacy report with no kind as before', () => {
    expect(stateAround(reported())).toContain(
      'teammate "port the sidebar" reported: CI is still running',
    )
  })
})
