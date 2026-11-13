import { useCallback } from 'react'

import { fetchAccounts } from '@/features/settings/data/personal/accounts-api'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

export type AccountLabelOf = (accountId: string) => string | undefined

export function useAccountLabel(): AccountLabelOf {
  const query = useCloudQuery({ key: 'failure-accounts', load: fetchAccounts })
  const accounts = query.state === EQueryState.Ready ? query.data : undefined
  return useCallback(
    (accountId) => accounts?.find((account) => account.id === accountId)?.label,
    [accounts],
  )
}
