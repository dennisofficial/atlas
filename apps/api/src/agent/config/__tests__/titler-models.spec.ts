import { describe, expect, it } from 'bun:test'
import { ESettingId } from '@dltech/atlas-core'

import { titlerModelsOf, type AccountRow } from '../model-config'
import { cipher } from './config-reader.fixture'
import { accountRow, setting } from './model-config.fixture'

const modelsOf = (args: {
  accounts: AccountRow[]
  settings?: Record<string, unknown>
  sessionRef?: { providerId: string; modelId: string }
}) =>
  titlerModelsOf({
    cipher,
    accounts: args.accounts,
    activeAccounts: [],
    settings: new Map(Object.entries(args.settings ?? {}).map(([k, v]) => [k, setting(v)])),
    sessionRef: args.sessionRef,
  })

describe('titlerModelsOf', () => {
  it('uses the quick model the settings name', () => {
    const { titler } = modelsOf({
      accounts: [accountRow({ id: 'o', provider: 'openai' })],
      settings: { [ESettingId.QuickModel]: 'openai/gpt-4.1-mini' },
    })

    expect(titler.choice.ref).toEqual({ providerId: 'openai', modelId: 'gpt-4.1-mini' })
    expect(titler.config).toMatchObject({ configured: true, accountId: 'o' })
  })

  it('follows the main model when the quick model provider has no account', () => {
    const { titler } = modelsOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { [ESettingId.QuickModel]: 'openai/gpt-4.1-mini' },
    })

    expect(titler.choice.ref.providerId).toBe('anthropic')
  })

  it('follows the main model when the quick model is unknown', () => {
    const { titler } = modelsOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { [ESettingId.QuickModel]: 'nowhere/none' },
    })

    expect(titler.choice.ref.providerId).toBe('anthropic')
  })

  it('follows the main model setting when there is no quick model', () => {
    const { titler } = modelsOf({
      accounts: [accountRow({ id: 'o', provider: 'openai' })],
      settings: { [ESettingId.ModelId]: 'openai/gpt-5' },
    })

    expect(titler.choice.ref).toEqual({ providerId: 'openai', modelId: 'gpt-5' })
  })

  it('offers the session model as the fallback on its own account', () => {
    const { fallback } = modelsOf({
      accounts: [
        accountRow({ id: 'a', provider: 'anthropic' }),
        accountRow({ id: 'g', provider: 'gateway' }),
      ],
      sessionRef: { providerId: 'gateway', modelId: 'deepseek/deepseek-v4' },
    })

    expect(fallback?.choice.ref).toEqual({ providerId: 'gateway', modelId: 'deepseek/deepseek-v4' })
    expect(fallback?.config).toMatchObject({ configured: true, accountId: 'g' })
  })

  it('offers no fallback without a session model', () => {
    expect(modelsOf({ accounts: [] }).fallback).toBeUndefined()
  })

  it('reports the gap when no account can answer', () => {
    expect(modelsOf({ accounts: [] }).titler.config).toMatchObject({ configured: false })
  })
})
