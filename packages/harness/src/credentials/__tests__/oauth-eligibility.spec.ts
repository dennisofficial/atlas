import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type StoredAccount,
} from '@dltech/atlas-core'

import { isOauthHandoffCandidate } from '../oauth-eligibility'

const CLOUD = 'https://cloud.test'

const stored = (overrides: Partial<StoredAccount> & { refreshToken?: string; authorityUrl?: string }): StoredAccount => {
  const { refreshToken = 'fake-refresh', authorityUrl, ...rest } = overrides
  return {
    id: toAccountId('acc_1'),
    provider: EAuthProvider.Anthropic,
    kind: EAuthKind.Oauth,
    origin: EAccountOrigin.Login,
    label: 'native',
    status: EAccountStatus.Active,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
    secret: {
      kind: EAuthKind.Oauth,
      tokens: { accessToken: 'fake-access', refreshToken, expiresAt: '2026-10-05T13:00:00.000Z' },
      ...(authorityUrl === undefined ? {} : { authority: { url: authorityUrl, connectionId: 'oauth_1' } }),
    },
    ...rest,
  }
}

describe('isOauthHandoffCandidate', () => {
  it('qualifies matching authority regardless of refresh state', () => {
    expect(isOauthHandoffCandidate({ stored: stored({ authorityUrl: `${CLOUD}/`, refreshToken: '' }), cloudUrl: CLOUD })).toBe(true)
  })

  it('rejects foreign authority', () => {
    expect(isOauthHandoffCandidate({ stored: stored({ authorityUrl: 'https://other.test' }), cloudUrl: CLOUD })).toBe(false)
  })

  it('qualifies a refreshable native login without authority', () => {
    expect(isOauthHandoffCandidate({ stored: stored({}), cloudUrl: CLOUD })).toBe(true)
  })

  it('rejects unrefreshable, CLI-imported, unsupported-provider and API-key records', () => {
    expect(isOauthHandoffCandidate({ stored: stored({ refreshToken: '' }), cloudUrl: CLOUD })).toBe(false)
    expect(isOauthHandoffCandidate({ stored: stored({ importedFrom: 'claude-code' }), cloudUrl: CLOUD })).toBe(false)
    expect(isOauthHandoffCandidate({ stored: stored({ importedFrom: 'codex' }), cloudUrl: CLOUD })).toBe(false)
    expect(isOauthHandoffCandidate({ stored: stored({ provider: EAuthProvider.OpenRouter }), cloudUrl: CLOUD })).toBe(false)
    expect(
      isOauthHandoffCandidate({
        stored: { ...stored({}), kind: EAuthKind.ApiKey, secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' } },
        cloudUrl: CLOUD,
      }),
    ).toBe(false)
  })
})
