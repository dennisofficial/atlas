'use client'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { EProviderId } from '../../fixtures/settings-agent'
import { fetchAccounts, fetchActiveAccountId, type Account } from './accounts-api'

export const ACCOUNTS_KEY = 'provider-logins'

export type ProviderAccountsData = {
  accounts: readonly Account[]
  active: Readonly<Record<string, string | null>>
}

const PROVIDERS = Object.values(EProviderId)

export async function loadProviderAccounts(): Promise<ProviderAccountsData> {
  const [accounts, active] = await Promise.all([
    fetchAccounts(),
    Promise.all(
      PROVIDERS.map(async (provider) => [provider, await fetchActiveAccountId(provider)] as const),
    ),
  ])
  return { accounts, active: Object.fromEntries(active) }
}

export function useProviderAccounts(): CloudQuery<ProviderAccountsData> {
  return useCloudQuery({ key: ACCOUNTS_KEY, load: loadProviderAccounts })
}
