import {
  AccountUsagePort,
  UNMETERED,
  isMetered,
  type AccountId,
  type AccountStorePort,
  type AccountUsageRequest,
  type EAuthProvider,
  type UsageReading,
} from '@dltech/atlas-core'

import type { UsageClient } from './account-usage-service'

type UsageClients = Partial<Record<EAuthProvider, UsageClient>>

export class RoutedAccountUsage extends AccountUsagePort {
  private readonly accounts: AccountStorePort
  private readonly clients: UsageClients

  constructor(args: { accounts: AccountStorePort; clients: UsageClients }) {
    super()
    this.accounts = args.accounts
    this.clients = args.clients
  }

  async read(request?: AccountUsageRequest): Promise<UsageReading | null> {
    if (request?.accountId !== undefined) return this.readAccount(request.accountId)

    for (const provider of Object.keys(this.clients) as EAuthProvider[]) {
      const accountId = await this.accounts.activeFor(provider)
      if (accountId === undefined) continue

      const reading = await this.readAccount(accountId)
      if (reading !== UNMETERED) return reading
    }

    return UNMETERED
  }

  private async readAccount(accountId: AccountId): Promise<UsageReading | null> {
    const stored = await this.accounts.read(accountId)
    if (stored === undefined || !isMetered(stored)) return UNMETERED

    const client = this.clients[stored.provider]
    if (client === undefined) return UNMETERED

    return client.read({ accountId: stored.id })
  }
}
