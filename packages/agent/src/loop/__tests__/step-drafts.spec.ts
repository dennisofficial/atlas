import { describe, expect, it } from 'bun:test'

import { EFinishReason, toCallId, type ModelStepResult } from '@dltech/atlas-core'

import { draftsFor, interruptedDrafts } from '../step-drafts'

const usage = { inputTokens: 40_000, outputTokens: 1_200 }
const WINDOW = 200_000
const call = { callId: toCallId('c1'), name: 'bash', input: {} }

const result = (change: Partial<ModelStepResult>): ModelStepResult => ({
  parts: [],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
  usage,
  ...change,
})

const stepOf = (change: Partial<ModelStepResult>) => ({ result: result(change) })

describe('the finish reason a draft carries', () => {
  it('rides on the reply so readers never look ahead to see a turn continue', () => {
    const parts = [{ type: 'text' as const, text: 'hi' }]
    const calling = draftsFor(
      stepOf({ parts, toolCalls: [call], finishReason: EFinishReason.ToolCalls }),
    )
    expect(calling[0]).toMatchObject({ type: 'assistant-said', finish: EFinishReason.ToolCalls })
    expect(draftsFor(stepOf({ parts }))[0]).toMatchObject({ finish: EFinishReason.Stop })
  })

  it('says other when the provider reported tool calls but the step made none, so the turn ends', () => {
    const parts = [{ type: 'text' as const, text: 'hi' }]
    const drafts = draftsFor(stepOf({ parts, finishReason: EFinishReason.ToolCalls }))
    expect(drafts[0]).toMatchObject({ type: 'assistant-said', finish: EFinishReason.Other })
  })

  it('is left off an interrupted reply, which ends the turn', () => {
    const drafts = interruptedDrafts(stepOf({ parts: [{ type: 'text', text: 'hi' }] }))
    expect(drafts[0]).not.toHaveProperty('finish')
  })
})

describe('the step usage a draft carries', () => {
  it('rides on the reply when the step spoke', () => {
    const drafts = draftsFor(stepOf({ parts: [{ type: 'text', text: 'hi' }], toolCalls: [call] }))
    expect(drafts[0]).toMatchObject({ type: 'assistant-said', usage })
    expect(drafts[1]).not.toHaveProperty('usage')
  })

  it('rides on the first call when the step only called tools', () => {
    const drafts = draftsFor(stepOf({ toolCalls: [call, { ...call, callId: toCallId('c2') }] }))
    expect(drafts[0]).toMatchObject({ type: 'tool-called', usage })
    expect(drafts[1]).not.toHaveProperty('usage')
  })

  it('is absent when the provider reported none', () => {
    const { usage: _dropped, ...unreported } = result({ parts: [{ type: 'text', text: 'hi' }] })
    const drafts = draftsFor({ result: unreported })
    expect(drafts[0]).not.toHaveProperty('usage')
  })

  it('records the window the call ran in, so the meter never guesses it from the picker', () => {
    const drafts = draftsFor({
      result: result({ toolCalls: [call] }),
      model: { traits: () => ({ contextWindow: WINDOW }) },
    })
    expect(drafts[0]).toMatchObject({ usage: { ...usage, contextWindow: WINDOW } })
  })

  it('leaves an unmeasured window out', () => {
    const drafts = draftsFor({
      result: result({ toolCalls: [call] }),
      model: { traits: () => ({}) },
    })
    expect(drafts[0]).toMatchObject({ usage })
    expect(drafts[0]).not.toHaveProperty('usage.contextWindow')
  })

  it('names the provider and model that ran the step', () => {
    const drafts = draftsFor({
      result: result({ toolCalls: [call] }),
      model: { identity: { id: 'anthropic', modelId: 'claude-sonnet-4-5' } },
    })
    expect(drafts[0]).toMatchObject({
      usage: { ...usage, providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    })
  })

  it('carries the model identity with the window when both are known', () => {
    const drafts = draftsFor({
      result: result({ toolCalls: [call] }),
      model: {
        identity: { id: 'openai', modelId: 'gpt-5' },
        traits: () => ({ contextWindow: WINDOW }),
      },
    })
    expect(drafts[0]).toMatchObject({
      usage: { ...usage, contextWindow: WINDOW, providerId: 'openai', modelId: 'gpt-5' },
    })
  })

  it('survives an interrupted step', () => {
    const drafts = interruptedDrafts(stepOf({ toolCalls: [call] }))
    expect(drafts[0]).toMatchObject({ type: 'tool-called', usage })
  })
})
