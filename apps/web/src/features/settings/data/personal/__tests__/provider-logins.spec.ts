import { describe, expect, it } from 'bun:test'

import { EProviderId } from '../../../fixtures/settings-agent'
import { EAccountKind, type Account } from '../accounts-api'
import { loginsOf } from '../provider-logins'

const account = (args: { id: string } & Partial<Omit<Account, 'id' | 'createdAt'>>): Account => ({
  id: args.id,
  provider: EProviderId.Anthropic,
  kind: EAccountKind.Oauth,
  label: 'Claude',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...args,
})

const idsOf = (logins: readonly Account[]): string[] => logins.map((login) => login.id)

describe('the logins a provider holds', () => {
  it('lists them oldest first when none is pointed at', () => {
    const result = loginsOf({
      accounts: [account({ id: 'a' }), account({ id: 'b' })],
      provider: EProviderId.Anthropic,
      activeId: null,
    })

    expect(idsOf(result.logins)).toEqual(['a', 'b'])
    expect(result.activeId).toBeNull()
  })

  it('puts the pointed-at login first and names it active', () => {
    const result = loginsOf({
      accounts: [account({ id: 'a' }), account({ id: 'b' }), account({ id: 'c' })],
      provider: EProviderId.Anthropic,
      activeId: 'b',
    })

    expect(idsOf(result.logins)).toEqual(['b', 'a', 'c'])
    expect(result.activeId).toBe('b')
  })

  it('leaves no login active when the pointer names the provider API key', () => {
    const result = loginsOf({
      accounts: [account({ id: 'login' }), account({ id: 'key', kind: EAccountKind.ApiKey })],
      provider: EProviderId.Anthropic,
      activeId: 'key',
    })

    expect(idsOf(result.logins)).toEqual(['login'])
    expect(result.activeId).toBeNull()
  })

  it('keeps one provider separate from another', () => {
    const result = loginsOf({
      accounts: [
        account({ id: 'claude' }),
        account({ id: 'chatgpt', provider: EProviderId.OpenAI }),
      ],
      provider: EProviderId.OpenAI,
      activeId: null,
    })

    expect(idsOf(result.logins)).toEqual(['chatgpt'])
  })

  it('ignores a pointer that names another provider login', () => {
    const result = loginsOf({
      accounts: [
        account({ id: 'claude' }),
        account({ id: 'chatgpt', provider: EProviderId.OpenAI }),
      ],
      provider: EProviderId.Anthropic,
      activeId: 'chatgpt',
    })

    expect(result.activeId).toBeNull()
  })
})
