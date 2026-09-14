import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
  type AccountDraft,
  type AccountSecret,
  type StoredAccount,
} from '@dltech/atlas-core'

import { CloudClient } from '../cloud-client'
import { RemoteAccountStore } from '../remote-account-store'

const secret: AccountSecret = { kind: EAuthKind.ApiKey, apiKey: 'sk-test' }

const account: Account = {
  id: toAccountId('acc_1'),
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const stored: StoredAccount = { ...account, secret }

class SpyCloudClient extends CloudClient {
  readonly calls: { method: string; args: unknown[] }[] = []

  constructor() {
    super({ url: 'http://cloud.test', token: 'unused' })
  }

  override async listAccounts(): Promise<readonly Account[]> {
    this.calls.push({ method: 'listAccounts', args: [] })
    return [account]
  }

  override async readAccount(args: { accountId: Account['id'] }): Promise<StoredAccount | undefined> {
    this.calls.push({ method: 'readAccount', args: [args] })
    return stored
  }

  override async addAccount(args: { draft: AccountDraft }): Promise<Account> {
    this.calls.push({ method: 'addAccount', args: [args] })
    return account
  }

  override async replaceAccountSecret(args: {
    accountId: Account['id']
    secret: AccountSecret
  }): Promise<void> {
    this.calls.push({ method: 'replaceAccountSecret', args: [args] })
  }

  override async setAccountStatus(args: {
    accountId: Account['id']
    status: EAccountStatus
  }): Promise<void> {
    this.calls.push({ method: 'setAccountStatus', args: [args] })
  }

  override async removeAccount(args: { accountId: Account['id'] }): Promise<void> {
    this.calls.push({ method: 'removeAccount', args: [args] })
  }

  override async setActiveAccount(args: {
    provider: EAuthProvider
    accountId: Account['id']
  }): Promise<void> {
    this.calls.push({ method: 'setActiveAccount', args: [args] })
  }

  override async activeAccount(args: { provider: EAuthProvider }): Promise<Account['id'] | undefined> {
    this.calls.push({ method: 'activeAccount', args: [args] })
    return account.id
  }
}

describe('RemoteAccountStore', () => {
  it('delegates every AccountStorePort method to the client', async () => {
    const client = new SpyCloudClient()
    const store = new RemoteAccountStore({ client })

    const draft: AccountDraft = {
      provider: EAuthProvider.Anthropic,
      label: 'work',
      secret,
      origin: EAccountOrigin.Login,
    }

    expect(await store.list()).toEqual([account])
    expect(await store.read(account.id)).toEqual(stored)
    expect(await store.add(draft)).toEqual(account)
    await store.replaceSecret({ accountId: account.id, secret })
    await store.setStatus({ accountId: account.id, status: EAccountStatus.Limited })
    await store.remove(account.id)
    await store.setActive({ provider: EAuthProvider.Anthropic, accountId: account.id })
    expect(await store.activeFor(EAuthProvider.Anthropic)).toBe(account.id)

    expect(client.calls).toEqual([
      { method: 'listAccounts', args: [] },
      { method: 'readAccount', args: [{ accountId: account.id }] },
      { method: 'addAccount', args: [{ draft }] },
      { method: 'replaceAccountSecret', args: [{ accountId: account.id, secret }] },
      {
        method: 'setAccountStatus',
        args: [{ accountId: account.id, status: EAccountStatus.Limited }],
      },
      { method: 'removeAccount', args: [{ accountId: account.id }] },
      {
        method: 'setActiveAccount',
        args: [{ provider: EAuthProvider.Anthropic, accountId: account.id }],
      },
      { method: 'activeAccount', args: [{ provider: EAuthProvider.Anthropic }] },
    ])
  })
})
