import { ETldrStatus, toRunId, toThreadId, type Event } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { endedOnQuestion, ETitleState, titleStateOf } from '../title-state'

const quiet = { working: false, asking: false, endedOnQuestion: false, backgroundBusy: false }

describe('the tab title state', () => {
  it('rests idle when nothing is going on', () => {
    expect(titleStateOf(quiet)).toBe(ETitleState.Idle)
  })

  it('works while the main loop runs', () => {
    expect(titleStateOf({ ...quiet, working: true })).toBe(ETitleState.Working)
  })

  it('works while only background shells or agents run', () => {
    expect(titleStateOf({ ...quiet, backgroundBusy: true })).toBe(ETitleState.Working)
  })

  it('needs the operator while an operator-input request is open mid-turn', () => {
    expect(titleStateOf({ ...quiet, working: true, asking: true })).toBe(ETitleState.NeedsOperator)
  })

  it('needs the operator when the turn ended on a question', () => {
    expect(titleStateOf({ ...quiet, endedOnQuestion: true })).toBe(ETitleState.NeedsOperator)
  })

  it('needs the operator when the turn ended on a question even with background work going', () => {
    expect(titleStateOf({ ...quiet, endedOnQuestion: true, backgroundBusy: true })).toBe(
      ETitleState.NeedsOperator,
    )
  })

  it('works when the loop is running again after a question', () => {
    expect(titleStateOf({ ...quiet, working: true, endedOnQuestion: true })).toBe(
      ETitleState.Working,
    )
  })
})

const THREAD = toThreadId('thread-1')

const event = (over: Partial<Event> & Pick<Event, 'type'>): Event =>
  ({
    id: `event-${String(over.seq ?? 1)}`,
    seq: 1,
    threadId: THREAD,
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-10-21T12:00:00.000Z',
    ...over,
  }) as Event

const asked = (seq: number): Event => event({ type: 'user-said', text: 'go', seq })

const replied = (seq: number): Event =>
  event({ type: 'assistant-said', parts: [{ type: 'text', text: 'which one?' }], seq })

const footer = (args: { anchorSeq: number; seq: number; status: ETldrStatus }): Event =>
  event({
    type: 'tldr-written',
    anchorSeq: args.anchorSeq,
    throughSeq: args.seq - 1,
    text: 'Asked which one.',
    modelId: 'claude-haiku-4-5-20251001',
    status: args.status,
    seq: args.seq,
  })

describe('a turn that ended on a question', () => {
  it('is read off the latest footer of the latest operator message', () => {
    const events = [
      asked(1),
      replied(2),
      footer({ anchorSeq: 1, seq: 3, status: ETldrStatus.NeedsOperator }),
    ]

    expect(endedOnQuestion(events)).toBe(true)
  })

  it('is not one when the footer says done', () => {
    const events = [
      asked(1),
      replied(2),
      footer({ anchorSeq: 1, seq: 3, status: ETldrStatus.Done }),
    ]

    expect(endedOnQuestion(events)).toBe(false)
  })

  it('stops counting once the operator answers', () => {
    const events = [
      asked(1),
      replied(2),
      footer({ anchorSeq: 1, seq: 3, status: ETldrStatus.NeedsOperator }),
      asked(4),
    ]

    expect(endedOnQuestion(events)).toBe(false)
  })
})
