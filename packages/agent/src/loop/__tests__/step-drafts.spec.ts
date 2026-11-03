import { describe, expect, it } from 'bun:test'

import { EFinishReason, toCallId, type ModelStepResult } from '@dltech/atlas-core'

import { draftsFor, interruptedDrafts } from '../step-drafts'

const usage = { inputTokens: 40_000, outputTokens: 1_200 }
const call = { callId: toCallId('c1'), name: 'bash', input: {} }

const step = (change: Partial<ModelStepResult>): ModelStepResult => ({
  parts: [],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
  usage,
  ...change,
})

describe('the step usage a draft carries', () => {
  it('rides on the reply when the step spoke', () => {
    const drafts = draftsFor(step({ parts: [{ type: 'text', text: 'hi' }], toolCalls: [call] }))
    expect(drafts[0]).toMatchObject({ type: 'assistant-said', usage })
    expect(drafts[1]).not.toHaveProperty('usage')
  })

  it('rides on the first call when the step only called tools', () => {
    const drafts = draftsFor(step({ toolCalls: [call, { ...call, callId: toCallId('c2') }] }))
    expect(drafts[0]).toMatchObject({ type: 'tool-called', usage })
    expect(drafts[1]).not.toHaveProperty('usage')
  })

  it('is absent when the provider reported none', () => {
    const { usage: _dropped, ...unreported } = step({ parts: [{ type: 'text', text: 'hi' }] })
    const drafts = draftsFor(unreported)
    expect(drafts[0]).not.toHaveProperty('usage')
  })

  it('survives an interrupted step', () => {
    const drafts = interruptedDrafts(step({ toolCalls: [call] }))
    expect(drafts[0]).toMatchObject({ type: 'tool-called', usage })
  })
})
