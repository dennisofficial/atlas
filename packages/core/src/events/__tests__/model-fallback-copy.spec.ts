import { describe, expect, it } from 'bun:test'

import { EModelFallbackReason, type ModelFellBackBody } from '../agent-body'
import { modelFallbackCopy } from '../model-fallback-copy'

const body = (reason: EModelFallbackReason): ModelFellBackBody => ({
  type: 'model-fell-back',
  role: 'builder',
  from: { ref: 'openai/gpt-5', label: 'GPT-5' },
  to: { ref: 'anthropic/claude-opus-5', label: 'Claude Opus 5' },
  reason,
})

describe('modelFallbackCopy', () => {
  it('says the role runs on the main agent model and why', () => {
    const copy = modelFallbackCopy(body(EModelFallbackReason.ProviderNotConnected))

    expect(copy.title).toBe('builder is running on Claude Opus 5')
    expect(copy.detail).toBe(
      "GPT-5 can't run because OpenAI isn't connected, so it uses the main agent's model. Connect OpenAI in Settings → Providers, or pick another model in Settings → Models & Effort.",
    )
  })

  it('says the credential failed when the provider is connected but rejected it', () => {
    const copy = modelFallbackCopy(body(EModelFallbackReason.CredentialFailed))

    expect(copy.title).toBe('builder is running on Claude Opus 5')
    expect(copy.detail).toBe(
      "GPT-5 failed on its OpenAI credential, so it switched to the main agent's model for the rest of this run.",
    )
  })

  it('falls back to a plain provider word when the ref names no known provider', () => {
    const copy = modelFallbackCopy({
      ...body(EModelFallbackReason.ProviderNotConnected),
      from: { ref: 'nope/gpt-5', label: 'GPT-5' },
    })

    expect(copy.detail).toContain("because the provider isn't connected")
  })
})
