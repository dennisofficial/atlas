import { describe, expect, it } from 'bun:test'

import { EModelFallbackReason } from '@dltech/atlas-core'

import { deriveTranscript } from '../derive-transcript'
import { EAuthor, EEntryKind } from '../transcript-model'
import { log } from './fixture'

const fellBack = (reason: EModelFallbackReason) =>
  log([
    {
      type: 'model-fell-back',
      role: 'builder',
      from: { ref: 'openai/gpt-5', label: 'GPT-5' },
      to: { ref: 'anthropic/claude-opus-5', label: 'Claude Opus 5' },
      reason,
    },
  ])

describe('a role that fell back to the main agent model', () => {
  it('shows a notice naming the role and the model it now runs', () => {
    const model = deriveTranscript({
      events: fellBack(EModelFallbackReason.ProviderNotConnected),
      signals: [],
    })

    expect(model.entries).toHaveLength(1)
    expect(model.entries[0]).toMatchObject({
      kind: EEntryKind.ModelFellBack,
      author: EAuthor.Model,
      text: 'builder is running on Claude Opus 5',
      content:
        "GPT-5 can't run because OpenAI isn't connected, so it uses the main agent's model. Connect OpenAI in Settings → Providers, or pick another model in Settings → Models & Effort.",
    })
  })

  it('says the credential failed rather than the provider missing', () => {
    const model = deriveTranscript({
      events: fellBack(EModelFallbackReason.CredentialFailed),
      signals: [],
    })

    expect(model.entries[0]?.text).toBe('builder is running on Claude Opus 5')
    expect(model.entries.map((entry) => entry.kind)).toEqual([EEntryKind.ModelFellBack])
  })
})
