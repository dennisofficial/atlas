import { describe, expect, it } from 'bun:test'

import { EFinishReason } from '../../stream/chunk'
import { EMPTY_STEP_NOTICE_STEPS, emptyStepNudgeDraft, retriableEmptyStep, silentStep } from '../empty-step'

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
