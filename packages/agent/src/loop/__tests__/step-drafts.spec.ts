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

  it('survives an interrupted step', () => {
    const drafts = interruptedDrafts(stepOf({ toolCalls: [call] }))
    expect(drafts[0]).toMatchObject({ type: 'tool-called', usage })
  })
})
