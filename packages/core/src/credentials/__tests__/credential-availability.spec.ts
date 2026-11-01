import { describe, expect, it } from 'bun:test'

import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
} from '../../models/provider-failure'
import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  storedAccountSchema,
  toAccountId,
  type StoredAccount,
} from '../account'
import {
  EAdmissionCompletion,
  ECredentialAvailability,
  ECredentialFence,
  admissionCompletionSchema,
  admissionPermitSchema,
  availabilityKeySchema,
  availabilitySnapshotSchema,
  credentialRevisionSchema,
  revisionOf,
} from '../credential-availability'

const base = {
  id: toAccountId('acct_1'),
  provider: EAuthProvider.Anthropic,
  origin: EAccountOrigin.Login,
  label: 'Work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: '2026-01-01T00:00:00.000Z' }

const apiKeyAccount = (authorizationRevision?: number): StoredAccount => ({
  ...base,
  kind: EAuthKind.ApiKey,
  secret: { kind: EAuthKind.ApiKey, apiKey: 'sk' },
  ...(authorizationRevision === undefined ? {} : { authorizationRevision }),
})

const oauthAccount = (args: {
  authority: boolean
  authorizationRevision?: number
}): StoredAccount => ({
  ...base,
  kind: EAuthKind.Oauth,
  secret: {
    kind: EAuthKind.Oauth,
    tokens,
    ...(args.authority
      ? { authority: { url: 'https://cloud.test', connectionId: 'oauth_1' } }
      : {}),
  },
  ...(args.authorizationRevision === undefined
    ? {}
    : { authorizationRevision: args.authorizationRevision }),
})

describe('revisionOf', () => {
  it('fences an api key by replacement', () => {
    expect(revisionOf(apiKeyAccount(4))).toEqual({ fence: ECredentialFence.Replaced, value: 4 })
  })

  it('fences an authority oauth account by refresh', () => {
    expect(revisionOf(oauthAccount({ authority: true, authorizationRevision: 7 }))).toEqual({
      fence: ECredentialFence.Refreshed,
      value: 7,
    })
  })

  it('fences a local oauth grant by replacement', () => {
    expect(revisionOf(oauthAccount({ authority: false, authorizationRevision: 2 }))).toEqual({
      fence: ECredentialFence.Replaced,
      value: 2,
    })
  })

  it('treats an absent revision as zero', () => {
    expect(revisionOf(apiKeyAccount()).value).toBe(0)
    expect(revisionOf(oauthAccount({ authority: true })).value).toBe(0)
  })
})

describe('authorizationRevision on a stored account', () => {
  it('round-trips and stays optional', () => {
    const withRevision = storedAccountSchema.parse(apiKeyAccount(3))
    const without = storedAccountSchema.parse(apiKeyAccount())

    expect(withRevision.authorizationRevision).toBe(3)
    expect(without.authorizationRevision).toBeUndefined()
  })

  it('rejects a negative or fractional revision', () => {
    expect(
      storedAccountSchema.safeParse({ ...apiKeyAccount(), authorizationRevision: -1 }).success,
    ).toBe(false)
    expect(
      storedAccountSchema.safeParse({ ...apiKeyAccount(), authorizationRevision: 1.5 }).success,
    ).toBe(false)
  })
})

describe('availability schemas', () => {
  const key = { accountId: toAccountId('acct_1'), providerId: 'anthropic', modelId: 'opus' }
  const revision = { fence: ECredentialFence.Refreshed, value: 2 }

  it('round-trips a key and a revision', () => {
    expect(availabilityKeySchema.parse(key)).toEqual(key)
    expect(credentialRevisionSchema.parse(revision)).toEqual(revision)
  })

  it('round-trips a snapshot with and without cooldown evidence', () => {
    const cooldown = {
      key,
      availability: ECredentialAvailability.Cooldown,
      revision,
      since: '2026-11-01T00:00:00.000Z',
      until: '2026-11-01T01:00:00.000Z',
      reason: 'limit reached',
    }
    const open = {
      key,
      availability: ECredentialAvailability.Available,
      revision,
      since: '2026-11-01T00:00:00.000Z',
    }

    expect(availabilitySnapshotSchema.parse(cooldown)).toEqual(cooldown)
    expect(availabilitySnapshotSchema.parse(open)).toEqual(open)
  })

  it('rejects an unknown availability or fence', () => {
    expect(
      availabilitySnapshotSchema.safeParse({
        key,
        availability: 'sleeping',
        revision,
        since: 'x',
      }).success,
    ).toBe(false)
    expect(credentialRevisionSchema.safeParse({ fence: 'rotated', value: 1 }).success).toBe(false)
  })

  it('round-trips a permit and each completion outcome', () => {
    const permit = { key, revision, probe: true, admittedAt: '2026-11-01T00:00:00.000Z' }
    const failed = {
      outcome: EAdmissionCompletion.Failed,
      failure: {
        kind: EProviderFailureKind.Quota,
        scope: EProviderFailureScope.Credential,
        retry: EProviderRetry.Never,
        message: 'limit',
      },
    }

    expect(admissionPermitSchema.parse(permit)).toEqual(permit)
    expect(admissionCompletionSchema.parse(failed)).toEqual(failed)
    expect(admissionCompletionSchema.parse({ outcome: EAdmissionCompletion.Succeeded })).toEqual({
      outcome: EAdmissionCompletion.Succeeded,
    })
    expect(admissionCompletionSchema.parse({ outcome: EAdmissionCompletion.Cancelled })).toEqual({
      outcome: EAdmissionCompletion.Cancelled,
    })
  })
})
