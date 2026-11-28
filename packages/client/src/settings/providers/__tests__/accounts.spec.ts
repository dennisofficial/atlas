import { describe, expect, it } from 'bun:test'
import {
  EKeyDialogMode,
  EProviderId,
  PROVIDER_CATALOGUE,
  providerGroupsOf,
  providerAccountDetailOf,
  planNameOf,
  providerKeyReady,
  providerKeyResult,
  type Account,
} from '..'

const account: Account = {
  id: 'key',
  provider: 'anthropic',
  kind: 'api-key',
  label: 'Work',
  status: 'active',
  keyHint: '1234',
  createdAt: '2026-11-01T00:00:00Z',
}

describe('provider groups and account details', () => {
  it('keeps all six providers and groups their accounts in catalogue order', () => {
    const groups = providerGroupsOf([account])
    expect(groups).toHaveLength(6)
    expect(groups[0]?.accounts).toEqual([account])
    expect(groups[1]?.accounts).toEqual([])
    expect(groups.map((group) => group.provider.id)).toEqual(Object.values(EProviderId))
  })
  it('formats a masked key and a dated plan', () => {
    const provider = PROVIDER_CATALOGUE[0]
    if (provider === undefined) throw new Error('missing provider')
    expect(providerAccountDetailOf({ provider, account })).toBe(
      'API key, sk-ant-…1234, Added Nov 1',
    )
    expect(providerAccountDetailOf({ provider, account })).not.toContain('\u00b7')
    expect(
      providerAccountDetailOf({
        provider,
        account: { ...account, kind: 'oauth', subscription: 'max' },
      }),
    ).toContain('Claude Max plan, Signed in')
    expect(
      providerAccountDetailOf({ provider, account: { ...account, keyHint: '' } }),
    ).not.toContain('…')
  })
  it('normalizes plan tiers without inventing an empty tier', () => {
    expect(planNameOf(null)).toBeNull()
    expect(planNameOf('  pro ')).toBe('Pro')
    expect(planNameOf('chatgpt_business')).toBe('Business')
    expect(planNameOf('custom_plan')).toBe('Custom Plan')
  })
})
describe('provider key forms', () => {
  it('requires a non-empty key except for rename, which requires a name', () => {
    expect(providerKeyReady({ mode: EKeyDialogMode.Add, name: '', key: '   ' })).toBe(false)
    expect(providerKeyReady({ mode: EKeyDialogMode.Replace, name: '', key: ' key ' })).toBe(true)
    expect(providerKeyReady({ mode: EKeyDialogMode.Rename, name: ' ', key: 'key' })).toBe(false)
    expect(providerKeyReady({ mode: EKeyDialogMode.Rename, name: 'Work', key: '' })).toBe(true)
  })
  it('trims values, defaults names and only activates when offered', () => {
    expect(providerKeyResult({ name: ' ', key: ' key ', use: true, offerUse: false })).toEqual({
      name: 'API key',
      key: 'key',
      use: false,
    })
    expect(providerKeyResult({ name: ' Work ', key: ' key ', use: true, offerUse: true })).toEqual({
      name: 'Work',
      key: 'key',
      use: true,
    })
  })
})
