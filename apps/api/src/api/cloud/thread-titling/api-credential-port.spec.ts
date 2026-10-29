import { describe, expect, it, vi } from 'bun:test'
import { EAuthKind } from '@dltech/atlas-harness/titling'
import type { AccountLease } from '@dltech/atlas-wire'
import { ApiCredentialPort } from './api-credential-port'

const account = (args: {
  id: string
  provider: string
  secret: AccountLease['accounts'][number]['secret']
}) =>
  ({
    id: args.id,
    provider: args.provider,
    kind: args.secret.kind,
    origin: 'login',
    label: args.id,
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    secret: args.secret,
  }) as AccountLease['accounts'][number]

const tokens = { accessToken: 'leased', refreshToken: '', expiresAt: '2026-11-01T00:00:00.000Z' }

const issued = (accessToken: string) => ({
  accessToken,
  expiresAt: '2026-11-01T00:00:00.000Z',
  providerAccountId: 'chatgpt-acct',
})

function portWith(lease: AccountLease) {
  const issueAccessToken = vi.fn(async (_args: { rejectedAccessToken?: string }) => issued('fresh'))
  const port = new ApiCredentialPort({
    userId: 'usr-1',
    lease,
    oauth: { issueAccessToken } as never,
  })
  return { port, issueAccessToken }
}

describe('ApiCredentialPort', () => {
  it('hands back the active API key for the provider', async () => {
    const { port } = portWith({
      accounts: [
        account({
          id: 'a1',
          provider: 'anthropic',
          secret: { kind: EAuthKind.ApiKey, apiKey: 'k1' },
        }),
        account({
          id: 'a2',
          provider: 'anthropic',
          secret: { kind: EAuthKind.ApiKey, apiKey: 'k2' },
        }),
      ],
      active: [{ provider: 'anthropic', accountId: 'a2' }],
    })

    expect(await port.read({ provider: 'anthropic' as never })).toEqual({
      kind: EAuthKind.ApiKey,
      accountId: 'a2' as never,
      apiKey: 'k2',
    })
  })

  it('issues an OAuth access token through the account authority', async () => {
    const { port, issueAccessToken } = portWith({
      accounts: [
        account({
          id: 'o1',
          provider: 'openai',
          secret: {
            kind: EAuthKind.Oauth,
            tokens,
            authority: { url: 'https://api', connectionId: 'conn-1' },
          },
        }),
      ],
      active: [],
    })

    const credential = await port.read({ provider: 'openai' as never })

    expect(issueAccessToken).toHaveBeenCalledWith({ userId: 'usr-1', connectionId: 'conn-1' })
    expect(credential).toMatchObject({ accessToken: 'fresh', providerAccountId: 'chatgpt-acct' })
  })

  it('names the discarded token as rejected on the next issue', async () => {
    const { port, issueAccessToken } = portWith({
      accounts: [
        account({
          id: 'o1',
          provider: 'openai',
          secret: {
            kind: EAuthKind.Oauth,
            tokens,
            authority: { url: 'https://api', connectionId: 'conn-1' },
          },
        }),
      ],
      active: [],
    })

    await port.discard(await port.read({ provider: 'openai' as never }))
    await port.read({ provider: 'openai' as never })

    expect(issueAccessToken.mock.calls[1]?.[0]).toMatchObject({ rejectedAccessToken: 'fresh' })
  })

  it('refuses a provider the user holds no account for', async () => {
    const { port } = portWith({ accounts: [], active: [] })
    await expect(port.read({ provider: 'anthropic' as never })).rejects.toThrow(
      'no anthropic account',
    )
  })
})
