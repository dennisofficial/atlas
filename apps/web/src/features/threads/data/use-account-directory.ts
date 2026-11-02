import { useCallback, useMemo } from 'react'

import { fetchAccounts } from '@/features/settings/data/personal/accounts-api'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

export type AccountDirectory = {
  labelOf: (accountId: string) => string | undefined
  isCloud: (accountId: string) => boolean
}

export function useAccountDirectory(): AccountDirectory {
  const query = useCloudQuery({ key: 'failure-accounts', load: fetchAccounts })
  const accounts = query.state === EQueryState.Ready ? query.data : undefined
  const labelOf = useCallback(
    (accountId: string) => accounts?.find((account) => account.id === accountId)?.label,
    [accounts],
  )
  const isCloud = useCallback(
    (accountId: string) => accounts?.some((account) => account.id === accountId) === true,
    [accounts],
  )
  return useMemo(() => ({ labelOf, isCloud }), [labelOf, isCloud])
}
