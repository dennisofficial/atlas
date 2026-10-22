import { describe, expect, it } from 'bun:test'

import { accountSecretSchema, authorityOf, EAuthKind } from '../account'

const tokens = { accessToken: 'a', refreshToken: '', expiresAt: '2026-01-01T00:00:00.000Z' }

describe('oauth authority on an account secret', () => {
  it('round-trips the marker with its optional metadata', () => {
    const secret = accountSecretSchema.parse({
      kind: EAuthKind.Oauth,
      tokens,
      authority: { url: 'https://cloud.test', connectionId: 'oauth_1', generation: 3 },
    })

    expect(authorityOf(secret)).toEqual({
      url: 'https://cloud.test',
      connectionId: 'oauth_1',
      generation: 3,
    })
  })

  it('leaves a local grant without authority', () => {
    const secret = accountSecretSchema.parse({ kind: EAuthKind.Oauth, tokens })

    expect(authorityOf(secret)).toBeUndefined()
  })

  it('has no authority on an api key', () => {
    const secret = accountSecretSchema.parse({ kind: EAuthKind.ApiKey, apiKey: 'sk' })

    expect(authorityOf(secret)).toBeUndefined()
  })
})
