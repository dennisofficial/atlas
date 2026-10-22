import { describe, expect, it } from 'bun:test'
import {
  AccountStorePort,
  CredentialPort,
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  EUsageWindow,
  UNMETERED,
  toAccountId,
  type AccountDraft,
  type AccountId,
  type AccountUsage,
  type Credential,
  type CredentialRequest,
  type StoredAccount,
} from '@dltech/atlas-core'

import { oauthCredential } from '../../credentials/testing'
import { AnthropicUsageClient } from '../anthropic-usage-client'
import type { UsageClient } from '../account-usage-service'
import { RoutedAccountUsage } from '../routed-account-usage'

const ANTHROPIC_OAUTH = toAccountId('anthropic-oauth')
const OPENROUTER_KEY = toAccountId('openrouter-key')
const ANTHROPIC_KEY = toAccountId('anthropic-key')

const stored = (args: {
  id: AccountId
  provider: EAuthProvider
  kind: EAuthKind
}): StoredAccount => ({
  id: args.id,
  provider: args.provider,
  kind: args.kind,
  origin: EAccountOrigin.Login,
  label: args.id,
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secret:
    args.kind === EAuthKind.Oauth
      ? { kind: EAuthKind.Oauth, tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00.000Z' } }
      : { kind: EAuthKind.ApiKey, apiKey: 'sk-x' },
})

class FakeStore extends AccountStorePort {
  constructor(
    private readonly accounts: readonly StoredAccount[],
    private readonly active: Partial<Record<EAuthProvider, AccountId>> = {},
  ) {
    super()
  }

  async list() {
    return this.accounts
  }
  async read(accountId: AccountId) {
    return this.accounts.find((account) => account.id === accountId)
  }
  async activeFor(provider: EAuthProvider) {
    return this.active[provider]
  }
  async add(_draft: AccountDraft): Promise<never> {
    throw new Error('unused')
  }
  async replaceSecret(): Promise<void> {}
  async setStatus(): Promise<void> {}
  async remove(): Promise<void> {}
  async setActive(): Promise<void> {}
}

const usageAt = (utilization: number): AccountUsage => ({
  [EUsageWindow.FiveHour]: { utilization, resetsAt: null },
  [EUsageWindow.SevenDay]: null,
})

const spyClient = (answer: AccountUsage | null = usageAt(42)) => {
  const asked: (AccountId | undefined)[] = []
  const client: UsageClient = {
    read: async (args) => {
      asked.push(args.accountId)
      return answer
    },
  }
  return { client, asked }
}

const STORE_ACCOUNTS = [
  stored({ id: ANTHROPIC_OAUTH, provider: EAuthProvider.Anthropic, kind: EAuthKind.Oauth }),
  stored({ id: ANTHROPIC_KEY, provider: EAuthProvider.Anthropic, kind: EAuthKind.ApiKey }),
  stored({ id: OPENROUTER_KEY, provider: EAuthProvider.OpenRouter, kind: EAuthKind.ApiKey }),
]

describe('RoutedAccountUsage', () => {
  it('reports an api-key account as unmetered without touching any client', async () => {
    const anthropic = spyClient()
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS),
      clients: { [EAuthProvider.Anthropic]: anthropic.client },
    })

    expect(await routed.read({ accountId: OPENROUTER_KEY })).toBe(UNMETERED)
    expect(await routed.read({ accountId: ANTHROPIC_KEY })).toBe(UNMETERED)
    expect(anthropic.asked).toEqual([])
  })

  it('reports an account the store does not know as unmetered', async () => {
    const anthropic = spyClient()
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS),
      clients: { [EAuthProvider.Anthropic]: anthropic.client },
    })

    expect(await routed.read({ accountId: toAccountId('ghost') })).toBe(UNMETERED)
    expect(anthropic.asked).toEqual([])
  })

  it('reports a metered account whose provider has no client as unmetered', async () => {
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore([
        stored({ id: toAccountId('codex'), provider: EAuthProvider.OpenAI, kind: EAuthKind.Oauth }),
      ]),
      clients: {},
    })

    expect(await routed.read({ accountId: toAccountId('codex') })).toBe(UNMETERED)
  })

  it('delegates an oauth account to its provider client with that account id', async () => {
    const anthropic = spyClient(usageAt(42))
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS),
      clients: { [EAuthProvider.Anthropic]: anthropic.client },
    })

    const reading = await routed.read({ accountId: ANTHROPIC_OAUTH })

    expect(reading).toEqual(usageAt(42))
    expect(anthropic.asked).toEqual([ANTHROPIC_OAUTH])
  })

  it('passes a client failure through as null so the service keeps its prior reading', async () => {
    const anthropic = spyClient(null)
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS),
      clients: { [EAuthProvider.Anthropic]: anthropic.client },
    })

    expect(await routed.read({ accountId: ANTHROPIC_OAUTH })).toBeNull()
  })

  it('never lets an api-key account resolve to another provider’s oauth credential', async () => {
    const requests: CredentialRequest[] = []
    class RecordingCredentials extends CredentialPort {
      async read(request?: CredentialRequest): Promise<Credential> {
        requests.push(request ?? {})
        return oauthCredential({ accessToken: 'anthropic-token', accountId: ANTHROPIC_OAUTH })
      }
      async discard(): Promise<void> {}
    }
    let fetched = 0
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS),
      clients: {
        [EAuthProvider.Anthropic]: new AnthropicUsageClient({
          credentials: new RecordingCredentials(),
          fetch: (async () => {
            fetched += 1
            return new Response(JSON.stringify({ five_hour: { utilization: 99, resets_at: null } }))
          }) as unknown as typeof globalThis.fetch,
        }),
      },
    })

    expect(await routed.read({ accountId: OPENROUTER_KEY })).toBe(UNMETERED)
    expect(requests).toEqual([])
    expect(fetched).toBe(0)

    const reading = await routed.read({ accountId: ANTHROPIC_OAUTH })

    expect(reading).not.toBe(UNMETERED)
    expect(requests.every((request) => request.provider === EAuthProvider.Anthropic)).toBe(true)
    expect(requests.map((request) => request.accountId)).toEqual([ANTHROPIC_OAUTH])
  })

  it('answers a request with no account from the active metered account', async () => {
    const anthropic = spyClient(usageAt(7))
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS, { [EAuthProvider.Anthropic]: ANTHROPIC_OAUTH }),
      clients: { [EAuthProvider.Anthropic]: anthropic.client },
    })

    expect(await routed.read()).toEqual(usageAt(7))
    expect(anthropic.asked).toEqual([ANTHROPIC_OAUTH])
  })

  it('is unmetered for a request with no account when only key accounts are active', async () => {
    const anthropic = spyClient()
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS, {
        [EAuthProvider.Anthropic]: ANTHROPIC_KEY,
        [EAuthProvider.OpenRouter]: OPENROUTER_KEY,
      }),
      clients: { [EAuthProvider.Anthropic]: anthropic.client },
    })

    expect(await routed.read()).toBe(UNMETERED)
    expect(anthropic.asked).toEqual([])
  })

  it('is unmetered for a request with no account when nothing is active', async () => {
    const routed = new RoutedAccountUsage({
      accounts: new FakeStore(STORE_ACCOUNTS),
      clients: { [EAuthProvider.Anthropic]: spyClient().client },
    })

    expect(await routed.read()).toBe(UNMETERED)
  })
})
