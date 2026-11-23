import { describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import {
  chosenFor,
  classifierCredentialOf,
  parsedAccountsOf,
  providerCredentialOf,
  reachableOf,
  type ActiveAccountRowLike,
  type SealedAccountRowLike,
} from '../accounts'

const rowOf = (
  overrides: Partial<SealedAccountRowLike> & { id: string },
): SealedAccountRowLike => ({
  provider: EAuthProvider.OpenAI,
  kind: EAuthKind.ApiKey,
  origin: 'login',
  label: overrides.id,
  status: 'active',
  email: null,
  subscription: null,
  importedFrom: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  sealedSecret: JSON.stringify({ kind: EAuthKind.ApiKey, apiKey: `key-${overrides.id}` }),
  ...overrides,
})

const unseal = (sealed: string): string => sealed

describe('parsedAccountsOf', () => {
  it('parses a valid row and drops a row with an unknown provider', () => {
    const parsed = parsedAccountsOf([rowOf({ id: 'a' }), rowOf({ id: 'b', provider: 'nobody' })])
    expect(parsed.map((entry) => entry.row.id)).toEqual(['a'])
  })
})

describe('chosenFor', () => {
  const parsed = parsedAccountsOf([
    rowOf({ id: 'old', updatedAt: new Date('2026-10-01T00:00:00Z') }),
    rowOf({ id: 'limited', status: 'limited', updatedAt: new Date('2026-11-20T00:00:00Z') }),
    rowOf({ id: 'fresh', updatedAt: new Date('2026-11-10T00:00:00Z') }),
  ])

  it('prefers the active account', () => {
    const chosen = chosenFor({
      provider: EAuthProvider.OpenAI,
      parsed,
      activeAccounts: [{ provider: EAuthProvider.OpenAI, accountId: 'old' }],
    })
    expect(chosen?.row.id).toBe('old')
  })

  it('takes the healthiest, then the freshest, with no active account', () => {
    const chosen = chosenFor({ provider: EAuthProvider.OpenAI, parsed, activeAccounts: [] })
    expect(chosen?.row.id).toBe('fresh')
  })

  it('answers nothing for a provider with no account', () => {
    expect(chosenFor({ provider: EAuthProvider.Gateway, parsed, activeAccounts: [] })).toBe(
      undefined,
    )
    const reachable = reachableOf({ parsed, activeAccounts: [] })
    expect([reachable('openai'), reachable('gateway'), reachable('nobody')]).toEqual([
      true,
      false,
      false,
    ])
  })
})

describe('providerCredentialOf', () => {
  const credentialFor = (rows: SealedAccountRowLike[]) =>
    providerCredentialOf({
      provider: EAuthProvider.OpenAI,
      parsed: parsedAccountsOf(rows),
      activeAccounts: [],
      unseal,
    })

  it('returns the key of an api-key account', () => {
    expect(credentialFor([rowOf({ id: 'k' })])).toEqual({
      kind: 'api-key',
      accountId: 'k',
      apiKey: 'key-k',
    })
  })

  it('returns a plan for an oauth account', () => {
    const sealedSecret = JSON.stringify({
      kind: EAuthKind.Oauth,
      tokens: { accessToken: 'a', refreshToken: '', expiresAt: '2026-12-01T00:00:00Z' },
      authority: { url: 'https://api', connectionId: 'conn' },
    })
    expect(credentialFor([rowOf({ id: 'p', kind: EAuthKind.Oauth, sealedSecret })])).toEqual({
      kind: 'plan',
      accountId: 'p',
      connectionId: 'conn',
    })
  })

  it('returns null with no account', () => {
    expect(credentialFor([])).toBeNull()
  })
})

describe('classifierCredentialOf', () => {
  const planSecret = JSON.stringify({
    kind: EAuthKind.Oauth,
    tokens: { accessToken: 'a', refreshToken: '', expiresAt: '2026-12-01T00:00:00Z' },
    authority: { url: 'https://api', connectionId: 'conn' },
  })

  const credentialFor = (
    rows: SealedAccountRowLike[],
    activeAccounts: readonly ActiveAccountRowLike[] = [],
  ) =>
    classifierCredentialOf({
      provider: EAuthProvider.OpenAI,
      parsed: parsedAccountsOf(rows),
      activeAccounts,
      unseal,
    })

  it('takes the api-key account even when an active plan account exists', () => {
    const rows = [
      rowOf({ id: 'plan', kind: EAuthKind.Oauth, sealedSecret: planSecret }),
      rowOf({ id: 'key' }),
    ]
    expect(credentialFor(rows, [{ provider: EAuthProvider.OpenAI, accountId: 'plan' }])).toEqual({
      kind: 'api-key',
      accountId: 'key',
      apiKey: 'key-key',
    })
  })

  it('reports a plan when the provider has no api-key account', () => {
    const rows = [rowOf({ id: 'plan', kind: EAuthKind.Oauth, sealedSecret: planSecret })]
    expect(credentialFor(rows)).toMatchObject({ kind: 'plan', accountId: 'plan' })
  })

  it('answers null when the provider has no account', () => {
    expect(credentialFor([])).toBeNull()
  })
})
