import { describe, expect, it } from 'bun:test'

import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../ids'
import { rewindShellPlan } from '../rewind-shells'
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

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const startedInBackground = (callId: string): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(callId),
  name: 'bash',
  input: { command: 'npm test', runInBackground: true },
  ordinal: 0,
})
const backgrounded = (callId: string, shellId: string): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name: 'bash',
  output: { shellId, status: 'running' },
})
const readShellOutput = (callId: string, shellId: string): EventDraft[] => [
  {
    type: 'tool-called',
    callId: toCallId(callId),
    name: 'shell_output',
    input: { shellId },
    ordinal: 0,
  },
  {
    type: 'tool-result',
    callId: toCallId(callId),
    name: 'shell_output',
    output: { shellId, status: 'running', text: 'a line' },
  },
]
const ended = (shellId: string, output: string): EventDraft => ({
  type: 'background-shell-ended',
  shellId,
  command: 'npm test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output,
  droppedCharacters: 0,
  remainingCharacters: 0,
})

/**
 * The transcript from the rewind discussion: a background shell started before msg_2 whose ending
 * only arrived after it. Rewinding to msg_2 must keep the ending; rewinding to msg_1 must drop it
 * with the rest of the shell.
 */
const transcript = (): Event[] =>
  eventsFrom([
    said('msg_1'),
    startedInBackground('call-1'),
    backgrounded('call-1', 'bash_1'),
    replied('on it'),
    said('msg_2'),
    ended('bash_1', 'all green'),
    said('msg_3'),
  ])

describe('rewindShellPlan', () => {
  it('keeps a notice that landed above the cut when its shell started below it', () => {
    const plan = rewindShellPlan({ events: transcript(), toSeq: 5 })

    expect(plan.cutShellIds).toEqual([])
    expect(plan.reappend).toHaveLength(1)
    expect(plan.reappend[0]?.draft).toEqual({
      type: 'background-shell-ended',
      shellId: 'bash_1',
      command: 'npm test',
      status: EShellStatus.Exited,
      exitCode: 0,
      output: 'all green',
      droppedCharacters: 0,
      remainingCharacters: 0,
    })
  })

  it('cuts a shell whose background start the cut removes, dropping every notice of it', () => {
    const plan = rewindShellPlan({ events: transcript(), toSeq: 1 })

    expect(plan.cutShellIds).toEqual(['bash_1'])
    expect(plan.reappend).toEqual([])
  })

  it('carries the notice runId so the re-append can keep provenance', () => {
    const plan = rewindShellPlan({ events: transcript(), toSeq: 5 })

    expect(plan.reappend[0]?.runId).toBe(toRunId('run-1'))
  })

  it('never keeps ordinary events from above the cut, only shell notices with a surviving source', () => {
    const plan = rewindShellPlan({ events: transcript(), toSeq: 5 })

    expect(plan.reappend.every((notice) => notice.draft.type.startsWith('background-shell-'))).toBe(
      true,
    )
    expect(plan.reappend).toHaveLength(1)
  })

  it('keeps a shell whose start the log no longer holds, the way summarisation leaves it', () => {
    const events = eventsFrom([said('msg_1'), ended('bash_7', 'from a compacted era')])

    const plan = rewindShellPlan({ events, toSeq: 1 })

    expect(plan.cutShellIds).toEqual([])
    expect(plan.reappend).toHaveLength(1)
  })

  it('does not read a shell_output call above the cut as the shell being started there', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedInBackground('call-1'),
      backgrounded('call-1', 'bash_1'),
      said('msg_2'),
      ...readShellOutput('call-2', 'bash_1'),
      ended('bash_1', 'all green'),
    ])

    const plan = rewindShellPlan({ events, toSeq: 4 })

    expect(plan.cutShellIds).toEqual([])
    expect(plan.reappend).toHaveLength(1)
  })

  it('cuts only the shell whose start is above the cut when two shells straddle it', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedInBackground('call-1'),
      backgrounded('call-1', 'bash_1'),
      said('msg_2'),
      startedInBackground('call-2'),
      backgrounded('call-2', 'bash_2'),
      ended('bash_1', 'all green'),
      ended('bash_2', 'also green'),
    ])

    const plan = rewindShellPlan({ events, toSeq: 4 })

    expect(plan.cutShellIds).toEqual(['bash_2'])
    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      expect.objectContaining({ shellId: 'bash_1' }),
    ])
  })

  it('keeps several notices of one surviving shell in their original order', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedInBackground('call-1'),
      backgrounded('call-1', 'bash_1'),
      said('msg_2'),
      ended('bash_1', 'first'),
      ended('bash_1', 'second'),
    ])

    const plan = rewindShellPlan({ events, toSeq: 4 })

    expect(plan.reappend.map((notice) => notice.draft.type)).toEqual([
      'background-shell-ended',
      'background-shell-ended',
    ])
  })
})
