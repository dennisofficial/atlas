import { EAuthProvider } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { suggestedModelOf, type ClassifierCredential } from '../availability'

const key = (): ClassifierCredential => ({ kind: 'api-key', accountId: 'acc' })

const only = (provider: EAuthProvider) => (candidate: EAuthProvider) =>
  candidate === provider ? key() : null

const both = (providers: readonly EAuthProvider[]) => (candidate: EAuthProvider) =>
  providers.includes(candidate) ? key() : null

const none = () => null

const suggestedLabel = (credentialOf: (provider: EAuthProvider) => ClassifierCredential | null) =>
  suggestedModelOf({ credentialOf })?.label

describe('suggestedModelOf', () => {
  it('suggests the gateway when only a gateway key exists', () => {
    expect(suggestedLabel(only(EAuthProvider.Gateway))).toBe('Jev through Vercel AI Gateway')
  })

  it('suggests OpenAI Decisions when only an OpenAI key exists', () => {
    expect(suggestedLabel(only(EAuthProvider.OpenAI))).toBe('OpenAI Decisions')
  })

  it('suggests the direct Jev row when both a TypeSafe and a gateway key exist', () => {
    expect(suggestedLabel(both([EAuthProvider.Typesafe, EAuthProvider.Gateway]))).toBe(
      'Jev, direct (TypeSafe)',
    )
  })

  it('suggests nothing when no account serves a decision model', () => {
    expect(suggestedModelOf({ credentialOf: none })).toBeUndefined()
  })

  it('never suggests a plan-only OpenAI account', () => {
    expect(
      suggestedModelOf({
        credentialOf: (provider) =>
          provider === EAuthProvider.OpenAI ? { kind: 'plan', accountId: 'acc_openai' } : null,
      }),
    ).toBeUndefined()
  })
})
