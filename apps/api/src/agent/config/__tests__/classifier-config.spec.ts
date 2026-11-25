import { describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider, ESettingId } from '@dltech/atlas-core'
import { EClassifierTransport } from '@dltech/atlas-classifier'

import { classifierConfigOf } from '../classifier-config'
import type { AccountRow } from '../model-config'
import { cipher, sealed } from './config-reader.fixture'
import { NOW, setting } from './model-config.fixture'

const apiKeyRow = (args: { id: string; provider: string; apiKey: string }): AccountRow => ({
  id: args.id,
  provider: args.provider,
  kind: EAuthKind.ApiKey,
  origin: 'login',
  label: args.id,
  status: 'active',
  email: null,
  subscription: null,
  importedFrom: null,
  sealedSecret: sealed({ kind: EAuthKind.ApiKey, apiKey: args.apiKey }),
  createdAt: NOW,
  updatedAt: NOW,
})

const planRow = (args: { id: string; provider: string }): AccountRow => ({
  ...apiKeyRow({ id: args.id, provider: args.provider, apiKey: 'unused' }),
  kind: EAuthKind.Oauth,
  sealedSecret: sealed({
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'a', refreshToken: '', expiresAt: '2026-12-01T00:00:00Z' },
    authority: { url: 'https://api', connectionId: 'conn' },
  }),
})

const configOf = (args: {
  accounts: AccountRow[]
  settings?: Record<string, unknown>
  active?: { provider: string; accountId: string }[]
}) =>
  classifierConfigOf({
    cipher,
    accounts: args.accounts,
    activeAccounts: args.active ?? [],
    settings: new Map(
      Object.entries(args.settings ?? {}).map(([key, value]) => [key, setting(value)]),
    ),
  })

describe('classifierConfigOf', () => {
  it('is on with the gateway key for the gateway Jev model', () => {
    expect(
      configOf({
        accounts: [apiKeyRow({ id: 'gw', provider: EAuthProvider.Gateway, apiKey: 'gateway-key' })],
        settings: { [ESettingId.ClassifierModel]: 'gateway/typesafe-ai/jev' },
      }),
    ).toEqual({
      on: true,
      transport: EClassifierTransport.Jev,
      endpoint: 'https://ai-gateway.vercel.sh/typesafe',
      model: 'typesafe-ai/jev-1.14.0',
      apiKey: 'gateway-key',
      pricing: {
        endpoint: 'https://ai-gateway.vercel.sh/typesafe',
        inputUsdPerMillion: 0.042,
        outputUsdPerMillion: 0,
      },
    })
  })

  it('is off with the NoModel reason when nothing is set', () => {
    expect(configOf({ accounts: [] })).toEqual({
      on: false,
      reason: 'no classifier model is set',
    })
  })

  it('is off with PlanHasNoKey when the provider is connected only by a plan', () => {
    expect(
      configOf({
        accounts: [planRow({ id: 'ts-plan', provider: EAuthProvider.Typesafe })],
        settings: { [ESettingId.ClassifierModel]: 'typesafe/jev-latest' },
      }),
    ).toEqual({
      on: false,
      reason: 'the provider is connected by a plan, which has no API key',
    })
  })

  it('is off with NotConnected when no account serves the provider', () => {
    expect(
      configOf({
        accounts: [],
        settings: { [ESettingId.ClassifierModel]: 'typesafe/jev-latest' },
      }),
    ).toEqual({ on: false, reason: 'the provider is not connected' })
  })

  it('takes the OpenAI api-key account even when the active account is a plan', () => {
    expect(
      configOf({
        accounts: [
          planRow({ id: 'plan', provider: EAuthProvider.OpenAI }),
          apiKeyRow({ id: 'key', provider: EAuthProvider.OpenAI, apiKey: 'sk-openai' }),
        ],
        active: [{ provider: EAuthProvider.OpenAI, accountId: 'plan' }],
        settings: { [ESettingId.ClassifierModel]: 'openai/gpt-6-luna' },
      }),
    ).toMatchObject({
      on: true,
      transport: EClassifierTransport.OpenAiDecisions,
      apiKey: 'sk-openai',
    })
  })
})
