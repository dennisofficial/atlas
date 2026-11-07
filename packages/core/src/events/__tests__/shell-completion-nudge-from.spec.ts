import { describe, expect, it } from 'bun:test'

import { loopStateOf, awaitsReplyOf } from '../../record/loop-state'
import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toCallId, toEventId, toRunId, toThreadId } from '../ids'
import { shellCompletionNudge, shellCompletionNudgeFrom } from '../shell-completion-nudge'
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
      at: '2026-10-01T16:00:00.000Z',
    })),
  })

const draftFor = (kind: number): EventDraft => {
  switch (kind) {
    case 0:
      return { type: 'user-said', text: 'ask' }
    case 1:
      return { type: 'assistant-said', parts: [{ type: 'text', text: 'reply' }] }
    case 2:
      return { type: 'nudge', text: 'note', lifetimeSteps: 1 }
    case 3:
      return {
        type: 'background-shell-ended',
        shellId: 'bash_1',
        command: 'echo done',
        status: EShellStatus.Exited,
        exitCode: 0,
        output: 'done',
        droppedCharacters: 0,
        remainingCharacters: 0,
      }
    case 4:
      return {
        type: 'tool-called',
        callId: toCallId('call'),
        name: 'bash',
        input: {},
        ordinal: 0,
      }
    default:
      return { type: 'tool-result', callId: toCallId('call'), name: 'bash', output: {} }
  }
}

const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4_294_967_296
  }
}

describe('shellCompletionNudgeFrom', () => {
  it('agrees with shellCompletionNudge on random logs', () => {
    const next = seeded(20_261_106)
    let nudged = 0
    for (let round = 0; round < 3000; round += 1) {
      const length = Math.floor(next() * 9)
      const events = eventsFrom(Array.from({ length }, () => draftFor(Math.floor(next() * 6))))
      const seenThrough = next() < 0.1 ? undefined : Math.floor(next() * (length + 1))

      const state = loopStateOf({ events })
      const lastAssistantSeq = state.lastAssistant?.seq
      const afterSeq = Math.min(seenThrough ?? 0, lastAssistantSeq ?? 0)
      const tail = events.filter((event) => event.seq > afterSeq)

      const whole = shellCompletionNudge({ events, seenThrough })
      const split = shellCompletionNudgeFrom({
        awaitingReply: awaitsReplyOf(state),
        lastAssistantSeq,
        tail,
        seenThrough,
      })

      expect(split).toEqual(whole)
      if (whole !== undefined) nudged += 1
    }
    expect(nudged).toBeGreaterThan(50)
  })
})
