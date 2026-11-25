import { EAuthProvider, EClassifierFault, type ClassifierQuestion } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { classifierConfigFrom, classifierOf, classifierStatusOf } from '../port'
import { EClassifierOffReason } from '../availability'
import { EClassifierTransport } from '../models'

const DANGER: ClassifierQuestion = { type: 'noul', instructions: 'Is this risky?' }

const neverFetches = (): typeof fetch =>
  (async () => {
    throw new Error('the off classifier must not call fetch')
  }) as unknown as typeof fetch

describe('classifierOf', () => {
  it('answers Unavailable with the reason, and never calls fetch, when off', async () => {
    const port = classifierOf(
      { on: false, reason: 'no classifier model is set' },
      { fetch: neverFetches() },
    )

    expect(
      await port.classify({
        state: 's',
        questions: { danger: DANGER },
        signal: new AbortController().signal,
      }),
    ).toEqual({
      ok: false,
      fault: EClassifierFault.Unavailable,
      detail: 'no classifier model is set',
    })
  })

  it('builds the Jev transport for a Jev config', async () => {
    const calls: string[] = []
    const port = classifierOf(
      {
        on: true,
        transport: EClassifierTransport.Jev,
        endpoint: 'https://api.typesafe.ai',
        model: 'jev-latest',
        apiKey: 'sk-jev',
      },
      {
        fetch: (async (input: string | URL | Request) => {
          calls.push(String(input))
          return new Response(JSON.stringify({ answers: { danger: { noul: 0.1 } } }))
        }) as typeof fetch,
      },
    )

    await port.classify({
      state: 's',
      questions: { danger: DANGER },
      signal: new AbortController().signal,
    })

    expect(calls).toEqual(['https://api.typesafe.ai/v1/systemone'])
  })
})

describe('classifierStatusOf', () => {
  it('names the model when on and the reason when off', () => {
    expect(
      classifierStatusOf({
        on: true,
        transport: EClassifierTransport.Jev,
        endpoint: 'https://api.typesafe.ai',
        model: 'jev-latest',
        apiKey: 'sk',
      }),
    ).toEqual({ on: true, model: 'jev-latest', provider: EClassifierTransport.Jev })
    expect(classifierStatusOf({ on: false, reason: 'off' })).toEqual({
      on: false,
      reason: 'off',
    })
  })

  it('carries the model prices and endpoint into the status when the config has them', () => {
    expect(
      classifierStatusOf({
        on: true,
        transport: EClassifierTransport.Jev,
        endpoint: 'https://api.typesafe.ai',
        model: 'jev-latest',
        apiKey: 'sk',
        pricing: {
          endpoint: 'https://api.typesafe.ai',
          inputUsdPerMillion: 0.042,
          outputUsdPerMillion: 0,
        },
      }),
    ).toEqual({
      on: true,
      model: 'jev-latest',
      provider: EClassifierTransport.Jev,
      pricing: {
        endpoint: 'https://api.typesafe.ai',
        inputUsdPerMillion: 0.042,
        outputUsdPerMillion: 0,
      },
    })
  })
})

describe('classifierConfigFrom', () => {
  it('turns an availability into an on config that carries the key', () => {
    expect(
      classifierConfigFrom({
        on: true,
        model: {
          ref: { providerId: 'gateway', modelId: 'typesafe-ai/jev' },
          label: 'Jev through Vercel AI Gateway',
          transport: EClassifierTransport.Jev,
          endpoint: 'https://ai-gateway.vercel.sh/typesafe',
          model: 'typesafe-ai/jev',
          provider: EAuthProvider.Gateway,
          inputUsdPerMillion: 0.042,
          outputUsdPerMillion: 0,
        },
        credential: { kind: 'api-key', accountId: 'acc', apiKey: 'gw-key' },
      }),
    ).toEqual({
      on: true,
      transport: EClassifierTransport.Jev,
      endpoint: 'https://ai-gateway.vercel.sh/typesafe',
      model: 'typesafe-ai/jev',
      apiKey: 'gw-key',
      pricing: {
        endpoint: 'https://ai-gateway.vercel.sh/typesafe',
        inputUsdPerMillion: 0.042,
        outputUsdPerMillion: 0,
      },
    })
  })

  it('is off NotConnected when the browser knows the account but not the key', () => {
    expect(
      classifierConfigFrom({
        on: true,
        model: {
          ref: { providerId: 'typesafe', modelId: 'jev-latest' },
          label: 'Jev, direct (TypeSafe)',
          transport: EClassifierTransport.Jev,
          endpoint: 'https://api.typesafe.ai',
          model: 'jev-latest',
          provider: EAuthProvider.Typesafe,
          inputUsdPerMillion: 0.042,
          outputUsdPerMillion: 0,
        },
        credential: { kind: 'api-key', accountId: 'acc' },
      }),
    ).toEqual({ on: false, reason: EClassifierOffReason.NotConnected })
  })

  it('passes an off availability reason through', () => {
    expect(classifierConfigFrom({ on: false, reason: EClassifierOffReason.PlanHasNoKey })).toEqual({
      on: false,
      reason: EClassifierOffReason.PlanHasNoKey,
    })
  })
})
