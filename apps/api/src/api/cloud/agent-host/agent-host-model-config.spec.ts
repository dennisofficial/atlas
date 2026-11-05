import { describe, expect, it } from 'bun:test'

import { EAuthKind } from '@dltech/atlas-core'

import type { AccountLease, StoredAccountDto } from './agent-host-account-types'

import { modelConfigOf, modelIdOf } from './agent-host-model-config'

const base = {
  provider: 'anthropic',
  origin: 'login',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

const oauthWithConnection: StoredAccountDto = {
  ...base,
  id: 'acc-oauth',
  kind: EAuthKind.Oauth,
  label: 'oauth account',
  secret: {
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'tok', refreshToken: '', expiresAt: '2026-11-04T00:00:00.000Z' },
    authority: { url: 'https://api.byatlas.io', connectionId: 'conn-1' },
  },
}

const oauthNoConnection: StoredAccountDto = {
  ...base,
  id: 'acc-loose',
  kind: EAuthKind.Oauth,
  label: 'loose oauth',
  secret: {
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'tok', refreshToken: '', expiresAt: '2026-11-04T00:00:00.000Z' },
  },
}

const apiKey: StoredAccountDto = {
  ...base,
  id: 'acc-key',
  kind: EAuthKind.ApiKey,
  label: 'key account',
  secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-x' },
}

const openAiKey: StoredAccountDto = {
  ...apiKey,
  id: 'acc-openai',
  provider: 'openai',
}

const leaseOf = (
  accounts: StoredAccountDto[],
  active: AccountLease['active'] = [],
): AccountLease => ({ accounts, active })

describe('modelConfigOf', () => {
  it('answers an oauth credential from the active anthropic account', () => {
    const result = modelConfigOf({
      lease: leaseOf([oauthWithConnection], [{ provider: 'anthropic', accountId: 'acc-oauth' }]),
      settings: { 'model.id': 'anthropic/claude-opus-4-1' },
    })
    expect(result).toEqual({
      configured: true,
      modelId: 'claude-opus-4-1',
      accountId: 'acc-oauth',
      credential: { kind: 'oauth', connectionId: 'conn-1' },
    })
  })

  it('answers an api-key credential', () => {
    const result = modelConfigOf({ lease: leaseOf([apiKey]), settings: {} })
    expect(result).toEqual({
      configured: true,
      modelId: 'claude-haiku-4-5',
      accountId: 'acc-key',
      credential: { kind: 'api-key', apiKey: 'sk-ant-x' },
    })
  })

  it('is unconfigured when no anthropic account exists', () => {
    const result = modelConfigOf({ lease: leaseOf([openAiKey]), settings: {} })
    expect(result.configured).toBe(false)
  })

  it('is unconfigured when the oauth account has no cloud connection', () => {
    const result = modelConfigOf({ lease: leaseOf([oauthNoConnection]), settings: {} })
    expect(result).toEqual({
      configured: false,
      gap: 'oauth account has no cloud connection',
    })
  })

  it('is unconfigured for an empty lease', () => {
    const result = modelConfigOf({ lease: leaseOf([]), settings: {} })
    expect(result.configured).toBe(false)
  })
})

describe('modelIdOf', () => {
  it('strips the anthropic provider from a stored refKey', () => {
    expect(modelIdOf({ 'model.id': 'anthropic/claude-opus-4-1' })).toBe('claude-opus-4-1')
  })

  it('decodes an encoded setting value before parsing the ref', () => {
    expect(modelIdOf({ 'model.id': 'atlas-setting:v1:"anthropic/claude-opus-4-1"' })).toBe(
      'claude-opus-4-1',
    )
  })

  it('falls back to the shipped default for a non-anthropic or missing setting', () => {
    expect(modelIdOf({ 'model.id': 'openai/gpt-5' })).toBe('claude-haiku-4-5')
    expect(modelIdOf({ 'model.id': 'atlas-setting:v1:"openai/gpt-5"' })).toBe('claude-haiku-4-5')
    expect(modelIdOf({})).toBe('claude-haiku-4-5')
  })
})
