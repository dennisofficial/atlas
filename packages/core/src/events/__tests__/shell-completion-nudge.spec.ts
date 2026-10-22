import { describe, expect, it } from 'bun:test'

import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import { toEventId, toRunId, toThreadId } from '../ids'
import { shellCompletionNudge } from '../shell-completion-nudge'
import { stampDrafts } from '../stamp'

const ending: EventDraft = {
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'echo done',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'done',
  droppedCharacters: 0,
  remainingCharacters: 0,
}
const answer: EventDraft = { type: 'assistant-said', parts: [{ type: 'text', text: 'waiting' }] }
const request: EventDraft = { type: 'user-said', text: 'run the build' }

function eventsFrom(drafts: readonly EventDraft[]) {
  return stampDrafts({
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
}

describe('a shell ending that arrives during an assistant reply', () => {
  it('hands the turn back without copying the already recorded output', () => {
    const events = eventsFrom([request, ending, answer])
    const nudge = shellCompletionNudge({ events, seenThrough: 1 })

    expect(nudge).toMatchObject({ type: 'nudge', lifetimeSteps: 1 })
    expect(nudge?.text).toContain('already recorded above')
    expect(nudge?.text).not.toContain('echo done')
  })

  it('needs no nudge when the ending already has the floor', () => {
    const events = eventsFrom([request, answer, ending])
    expect(shellCompletionNudge({ events, seenThrough: 1 })).toBeUndefined()
  })

  it('does not nudge for an ending the step already saw, whether or not the reply trails it', () => {
    const events = eventsFrom([request, ending, answer])
    expect(shellCompletionNudge({ events, seenThrough: 2 })).toBeUndefined()
  })

  it('does not nudge twice for an ending it already nudged', () => {
    const nudge: EventDraft = {
      type: 'nudge',
      text: 'A background shell finished while you were responding.',
      lifetimeSteps: 1,
    }
    const events = eventsFrom([request, ending, answer, nudge])
    expect(shellCompletionNudge({ events, seenThrough: 2 })).toBeUndefined()
  })

  it('does not invent an unseen ending when no model step has run', () => {
    const events = eventsFrom([request, ending, answer])
    expect(shellCompletionNudge({ events, seenThrough: undefined })).toBeUndefined()
  })

  it('does not change the handling of operator messages written out of order', () => {
    const events = eventsFrom([request, request, answer])
    expect(shellCompletionNudge({ events, seenThrough: 1 })).toBeUndefined()
  })
})
