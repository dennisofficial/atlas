import { describe, expect, it } from 'bun:test'

import { EFinishReason } from '../../stream/chunk'
import { EAssistantPlaceholder, type EventDraft } from '../body'
import {
  EMPTY_STEP_NOTICE_STEPS,
  EMPTY_STEP_STREAK_LIMIT,
  NO_CONTENT_TEXT,
  emptyStepNudgeDraft,
  emptyTurnBlocked,
  noContentDraft,
  noContentStreak,
  retriableEmptyStep,
  silentStep,
} from '../empty-step'
import type { Event } from '../envelope'
import { toEventId, toRunId, toThreadId } from '../ids'
import { eventBodySchema } from '../schema'
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

const said = (text: string): EventDraft => ({ type: 'assistant-said', parts: [{ type: 'text', text }] })

describe('silentStep', () => {
  it('reads a step with no parts and no tool calls as silent', () => {
    expect(silentStep({ parts: [], toolCalls: [] })).toBe(true)
  })

  it('reads whitespace-only text as silent, since the operator sees nothing', () => {
    expect(silentStep({ parts: [{ type: 'text', text: '  \n ' }], toolCalls: [] })).toBe(true)
  })

  it('reads reasoning without text as silent, since reasoning is not a reply', () => {
    expect(silentStep({ parts: [{ type: 'reasoning', text: 'thinking' }], toolCalls: [] })).toBe(true)
  })

  it('reads any real text as an answer', () => {
    expect(silentStep({ parts: [{ type: 'text', text: 'here is what I found' }], toolCalls: [] })).toBe(false)
  })

  it('reads a tool call as an answer however empty the text is', () => {
    expect(
      silentStep({ parts: [], toolCalls: [{ callId: 'read_1', name: 'read', input: {} }] }),
    ).toBe(false)
  })
})

describe('retriableEmptyStep', () => {
  it('flags a silent stop as worth a raw re-request', () => {
    expect(retriableEmptyStep({ parts: [], toolCalls: [], finishReason: EFinishReason.Stop })).toBe(true)
  })

  it('flags whitespace-only text stopped cleanly as worth a raw re-request', () => {
    expect(
      retriableEmptyStep({
        parts: [{ type: 'text', text: ' \n ' }],
        toolCalls: [],
        finishReason: EFinishReason.Stop,
      }),
    ).toBe(true)
  })

  it('never retries a decided answer, only dropped completions', () => {
    for (const finishReason of [
      EFinishReason.Error,
      EFinishReason.ContentFilter,
      EFinishReason.Length,
      EFinishReason.Other,
      EFinishReason.ToolCalls,
    ]) {
      expect(retriableEmptyStep({ parts: [], toolCalls: [], finishReason })).toBe(false)
    }
  })

  it('never retries a step that actually answered', () => {
    expect(
      retriableEmptyStep({
        parts: [{ type: 'text', text: 'here is what I found' }],
        toolCalls: [],
        finishReason: EFinishReason.Stop,
      }),
    ).toBe(false)
    expect(
      retriableEmptyStep({
        parts: [],
        toolCalls: [{ callId: 'read_1', name: 'read', input: {} }],
        finishReason: EFinishReason.Stop,
      }),
    ).toBe(false)
  })
})

describe('emptyStepNudgeDraft', () => {
  it('is a bounded nudge that names the empty reply and tells the agent to answer', () => {
    const draft = emptyStepNudgeDraft()

    expect(draft.type).toBe('nudge')
    expect(draft.type === 'nudge' ? draft.lifetimeSteps : 0).toBe(EMPTY_STEP_NOTICE_STEPS)
    expect(draft.type === 'nudge' ? draft.text : '').toMatch(/empty/)
    expect(draft.type === 'nudge' ? draft.text : '').toMatch(/Reply now/)
  })
})

describe('noContentDraft', () => {
  it('renders as a stable <no content> assistant-said carrying the placeholder flag', () => {
    const draft = noContentDraft()

    expect(draft.type).toBe('assistant-said')
    expect(draft.type === 'assistant-said' ? draft.placeholder : undefined).toBe(
      EAssistantPlaceholder.NoContent,
    )
    const parts = draft.type === 'assistant-said' ? draft.parts : []
    expect(parts).toEqual([{ type: 'text', text: NO_CONTENT_TEXT }])
    expect(NO_CONTENT_TEXT).toBe('<no content>')
  })

  it('round-trips through the stored event schema', () => {
    expect(eventBodySchema.safeParse(noContentDraft()).success).toBe(true)
  })
})

describe('noContentStreak', () => {
  it('counts consecutive placeholder endings back from the tail', () => {
    const events = eventsFrom([
      { type: 'user-said', text: 'one' },
      noContentDraft(),
      { type: 'user-said', text: 'two' },
      noContentDraft(),
    ])

    expect(noContentStreak(events)).toBe(2)
  })

  it('stops counting at the last real reply even when other events sit between', () => {
    const events = eventsFrom([
      noContentDraft(),
      noContentDraft(),
      said('a real answer'),
      { type: 'user-said', text: 'more' },
      noContentDraft(),
    ])

    expect(noContentStreak(events)).toBe(1)
  })

  it('reads zero on a thread that never ended silently', () => {
    expect(noContentStreak(eventsFrom([said('fine')]))).toBe(0)
    expect(noContentStreak([])).toBe(0)
  })
})

describe('emptyTurnBlocked', () => {
  it('blocks only once the streak reaches the limit', () => {
    const below = eventsFrom(Array.from({ length: EMPTY_STEP_STREAK_LIMIT - 1 }, noContentDraft))
    const at = eventsFrom(Array.from({ length: EMPTY_STEP_STREAK_LIMIT }, noContentDraft))

    expect(emptyTurnBlocked(below)).toBe(false)
    expect(emptyTurnBlocked(at)).toBe(true)
    expect(EMPTY_STEP_STREAK_LIMIT).toBe(3)
  })
})
