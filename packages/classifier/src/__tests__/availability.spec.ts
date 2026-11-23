import { EAuthProvider } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  classifierAvailabilityOf,
  EClassifierOffReason,
  type ClassifierCredential,
} from '../availability'

const noCredential = () => null

const credentialOf =
  (held: Partial<Record<EAuthProvider, ClassifierCredential>>) =>
  (provider: EAuthProvider): ClassifierCredential | null =>
    held[provider] ?? null

const API_KEY = { kind: 'api-key', accountId: 'acc_jev', apiKey: 'sk-jev' } as const

describe('classifierAvailabilityOf', () => {
  it('is off with NoModel when nothing is stored', () => {
    expect(classifierAvailabilityOf({ stored: undefined, credentialOf: noCredential })).toEqual({
      on: false,
      reason: EClassifierOffReason.NoModel,
    })
  })

  it('is off with NoModel when the stored value is not a ref', () => {
    expect(classifierAvailabilityOf({ stored: 'jev', credentialOf: noCredential })).toEqual({
      on: false,
      reason: EClassifierOffReason.NoModel,
    })
  })

  it('is off with UnknownModel when the ref is not in the table', () => {
    expect(
      classifierAvailabilityOf({ stored: 'openai/gpt-5', credentialOf: noCredential }),
    ).toEqual({ on: false, reason: EClassifierOffReason.UnknownModel })
  })

  it('is off with NotConnected and names the provider when no account serves it', () => {
    expect(
      classifierAvailabilityOf({
        stored: 'gateway/typesafe-ai/jev',
        credentialOf: credentialOf({}),
      }),
    ).toEqual({
      on: false,
      reason: EClassifierOffReason.NotConnected,
      provider: EAuthProvider.Gateway,
    })
  })

  it('is off with PlanHasNoKey for a plan account', () => {
    expect(
      classifierAvailabilityOf({
        stored: 'openai/gpt-6-luna',
        credentialOf: credentialOf({
          [EAuthProvider.OpenAI]: { kind: 'plan', accountId: 'acc_openai' },
        }),
      }),
    ).toEqual({
      on: false,
      reason: EClassifierOffReason.PlanHasNoKey,
      provider: EAuthProvider.OpenAI,
    })
  })

  it('is on with an api-key account that carries no key, the browser case', () => {
    const availability = classifierAvailabilityOf({
      stored: 'typesafe/jev-latest',
      credentialOf: credentialOf({
        [EAuthProvider.Typesafe]: { kind: 'api-key', accountId: 'acc_jev' },
      }),
    })

    expect(availability.on).toBe(true)
    expect(availability.on ? availability.model.label : undefined).toBe('Jev, direct (TypeSafe)')
    expect(availability.on ? availability.credential : undefined).toEqual({
      kind: 'api-key',
      accountId: 'acc_jev',
    })
  })

  it('is on with the key when the host supplies it', () => {
    const availability = classifierAvailabilityOf({
      stored: 'typesafe/jev-latest',
      credentialOf: credentialOf({ [EAuthProvider.Typesafe]: API_KEY }),
    })

    expect(availability.on ? availability.credential.apiKey : undefined).toBe('sk-jev')
  })
})
