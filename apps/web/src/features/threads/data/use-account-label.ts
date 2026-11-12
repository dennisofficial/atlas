import { useCallback } from 'react'

import { fetchAccounts, type Account } from '@/features/settings/data/personal/accounts-api'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

export type AccountLabelOf = (accountId: string) => string | undefined

const NO_ACCOUNTS: readonly Account[] = []

export function useAccounts(): readonly Account[] {
  const query = useCloudQuery({ key: 'failure-accounts', load: fetchAccounts })
  return query.state === EQueryState.Ready ? query.data : NO_ACCOUNTS
}

export function useAccountLabel(): AccountLabelOf {
  const accounts = useAccounts()
  return useCallback(
    (accountId) => accounts.find((account) => account.id === accountId)?.label,
    [accounts],
  )
}
