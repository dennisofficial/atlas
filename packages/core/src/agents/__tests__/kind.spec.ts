import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../status'
import type { EventDraft } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { isTurnTaking } from '../kind'
import { EReportKind } from '../report'

const ending = (over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {}): EventDraft => ({
  type: 'agent-ended',
  agentId: toThreadId('thread-child-1'),
  agentType: 'teammate',
  intent: 'build the admin app',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
  ...over,
})

const report = (kind?: EReportKind): EventDraft => ({
  type: 'agent-reported',
  agentId: toThreadId('thread-child-1'),
  agentType: 'teammate',
  intent: 'build the admin app',
  prose: 'update',
  kind,
})

describe('which agent events hand the turn to the parent', () => {
  it('does not for a bookkeeping ending recorded without waking the parent', () => {
    expect(isTurnTaking(ending({ relayed: false }))).toBe(false)
  })

  it('does for a relayed ending, flagged or legacy', () => {
    expect(isTurnTaking(ending({ relayed: true }))).toBe(true)
    expect(isTurnTaking(ending())).toBe(true)
  })

  it('does not for a progress report', () => {
    expect(isTurnTaking(report(EReportKind.Progress))).toBe(false)
  })

  it('does for done, blocked and needs-decision reports', () => {
    for (const kind of [EReportKind.Done, EReportKind.Blocked, EReportKind.NeedsDecision]) {
      expect(isTurnTaking(report(kind))).toBe(true)
    }
  })

  it('does for a legacy report with no kind', () => {
    expect(isTurnTaking(report())).toBe(true)
  })
})
