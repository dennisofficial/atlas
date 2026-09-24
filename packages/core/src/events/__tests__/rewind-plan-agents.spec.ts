import { describe, expect, it } from 'bun:test'

import { EAgentRestart } from '../../agents/restart'
import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../ids'
import { rewindPlan } from '../rewind-plan'
import { stampDrafts } from '../stamp'

const CHILD = toThreadId('thread_child')

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

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const spawned = (agentId = CHILD): EventDraft => ({
  type: 'agent-spawned',
  agentId,
  agentType: 'explore',
  intent: 'find the callers',
  mode: EAgentStart.Fresh,
})
const agentEnded = (agentId = CHILD): EventDraft => ({
  type: 'agent-ended',
  agentId,
  agentType: 'explore',
  intent: 'find the callers',
  status: EAgentStatus.Finished,
  prose: 'four callers',
  turns: 3,
  toolCalls: 7,
})
const restarted = (agentId = CHILD): EventDraft => ({
  type: 'agent-restarted',
  agentId,
  agentType: 'explore',
  intent: 'find the callers',
  via: EAgentRestart.Resume,
})

describe('rewindPlan for sub-agents', () => {
  it('cuts a child whose spawn sits above the cut, whether or not it ever ended', () => {
    const live = eventsFrom([said('delegate'), spawned(), said('still waiting')])
    const ended = eventsFrom([said('delegate'), spawned(), agentEnded(), said('reported')])

    expect(rewindPlan({ events: live, toSeq: 1 }).cuts).toEqual([
      { kind: 'agent', seq: 2, agentId: CHILD, agentType: 'explore', intent: 'find the callers' },
    ])
    expect(rewindPlan({ events: ended, toSeq: 1 }).cuts).toEqual([
      { kind: 'agent', seq: 2, agentId: CHILD, agentType: 'explore', intent: 'find the callers' },
    ])
  })

  it('drops the ending of a cut child with the rest of its record', () => {
    const events = eventsFrom([said('delegate'), spawned(), agentEnded(), said('reported')])

    expect(rewindPlan({ events, toSeq: 1 }).reappend).toEqual([])
  })

  it('keeps the ending of a child whose spawn sits at or below the cut', () => {
    const events = eventsFrom([said('delegate'), spawned(), said('msg_2'), agentEnded()])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      expect.objectContaining({ type: 'agent-ended', agentId: CHILD }),
    ])
  })

  it('keeps the ending of a child whose spawn the log no longer holds', () => {
    const events = eventsFrom([said('msg_1'), agentEnded()])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend).toHaveLength(1)
  })

  it('cuts only the child spawned above the cut when two straddle it', () => {
    const other = toThreadId('thread_other')
    const events = eventsFrom([
      spawned(),
      said('msg_2'),
      spawned(other),
      agentEnded(),
      agentEnded(other),
    ])

    const plan = rewindPlan({ events, toSeq: 2 })

    expect(plan.cuts.map((cut) => cut.kind === 'agent' && cut.agentId)).toEqual([other])
    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      expect.objectContaining({ agentId: CHILD }),
    ])
  })

  it('cuts a child whose restart sits above the cut, though its spawn survives', () => {
    const events = eventsFrom([spawned(), agentEnded(), said('msg_3'), restarted(), said('msg_5')])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(plan.cuts).toEqual([
      { kind: 'agent', seq: 4, agentId: CHILD, agentType: 'explore', intent: 'find the callers' },
    ])
  })

  it('never re-appends a restart, and drops the ending of the child it cut', () => {
    const events = eventsFrom([spawned(), agentEnded(), restarted(), agentEnded()])

    const plan = rewindPlan({ events, toSeq: 2 })

    expect(plan.reappend).toEqual([])
  })
})

describe('rewindPlan across kinds', () => {
  it('re-appends surviving notices of every kind in their original order', () => {
    const events = eventsFrom([
      said('delegate'),
      spawned(),
      {
        type: 'tool-called',
        callId: toCallId('call-1'),
        name: 'bash',
        input: { command: 'npm test', runInBackground: true },
        ordinal: 0,
      },
      {
        type: 'tool-result',
        callId: toCallId('call-1'),
        name: 'bash',
        output: { shellId: 'bash_1', status: 'running' },
      },
      said('msg_2'),
      {
        type: 'background-shell-ended',
        shellId: 'bash_1',
        command: 'npm test',
        status: EShellStatus.Exited,
        exitCode: 0,
        output: 'all green',
        droppedCharacters: 0,
        remainingCharacters: 0,
      },
      agentEnded(),
    ])

    const plan = rewindPlan({ events, toSeq: 5 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend.map((notice) => notice.draft.type)).toEqual([
      'background-shell-ended',
      'agent-ended',
    ])
  })
})
