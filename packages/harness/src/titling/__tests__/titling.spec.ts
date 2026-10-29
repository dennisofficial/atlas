import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ESettingId,
  toAccountId,
  type Account,
  type CredentialPort,
} from '@dltech/atlas-core'

import { encodeSettingValue } from '@dltech/atlas-wire/web'

import { createStandaloneTitler, titlerRefOf } from '../index'

const account = (provider: EAuthProvider): Account => ({
  id: toAccountId(`acc-${provider}`),
  provider,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: provider,
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const refusing: CredentialPort = {
  read: () => Promise.reject(new Error('no credentials')),
  discard: () => Promise.resolve(),
}

describe('titlerRefOf', () => {
  it('uses the quick model the settings name', () => {
    const ref = titlerRefOf({
      settings: { [ESettingId.QuickModel]: 'openai/gpt-4.1-mini' },
      accounts: [account(EAuthProvider.OpenAI)],
    })

    expect(ref).toEqual({ providerId: 'openai', modelId: 'gpt-4.1-mini' })
  })

  it('decodes JSON-encoded cloud setting values', () => {
    const ref = titlerRefOf({
      settings: { [ESettingId.QuickModel]: encodeSettingValue('openai/gpt-4.1-mini') },
      accounts: [account(EAuthProvider.OpenAI)],
    })

    expect(ref.modelId).toBe('gpt-4.1-mini')
  })

  it('ignores an unknown quick model and follows the default', () => {
    const ref = titlerRefOf({
      settings: { [ESettingId.QuickModel]: 'nowhere/none' },
      accounts: [account(EAuthProvider.Anthropic)],
    })

    expect(ref.providerId).toBe('anthropic')
  })
})

describe('createStandaloneTitler', () => {
  it('answers null without throwing when no provider is reachable', async () => {
    const titler = createStandaloneTitler({ settings: {}, accounts: [], credentials: refusing })

    expect(await titler({ text: 'fix the login bug' })).toBeNull()
  })

  it('answers null for an empty message', async () => {
    const titler = createStandaloneTitler({ settings: {}, accounts: [], credentials: refusing })

    expect(await titler({ text: '  ' })).toBeNull()
  })
})
