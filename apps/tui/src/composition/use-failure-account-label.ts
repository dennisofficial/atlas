import { useEffect, useState } from 'react'

import type { AccountsService } from '@dltech/atlas-harness'

export function useFailureAccountLabel(args: {
  accounts: AccountsService
  accountId: string | undefined
}): string | undefined {
  const { accounts, accountId } = args
  const [resolved, setResolved] = useState<{
    accountId: string
    label: string
  } | null>(null)

  useEffect(() => {
    if (accountId === undefined) return
    let live = true
    void accounts
      .list()
      .then((held) => {
        const label = held.find((account) => account.id === accountId)?.label
        if (live && label !== undefined) {
          setResolved((current) =>
            current?.accountId === accountId && current.label === label
              ? current
              : { accountId, label },
          )
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [accounts, accountId])

  return resolved !== null && resolved.accountId === accountId ? resolved.label : undefined
}
