import { useMemo } from 'react'

import type { PullRequestBell } from '../github/pull-request-entry-row'
import type { SubscriptionsAccess } from './access'
import { bellFor } from './bell'
import { useSubscriptionState } from './use-subscription-state'

export function usePullRequestBell(args: {
  access: SubscriptionsAccess | null
  projectDirectory: string
}): PullRequestBell | undefined {
  const { access, projectDirectory } = args
  const { views, threadId } = useSubscriptionState(access)

  return useMemo(() => {
    if (access === null || threadId === undefined) return undefined

    return ({ repo, number }) =>
      bellFor({
        views,
        repo,
        number,
        ring: (existing) =>
          access.actions.ring({
            threadId,
            repo,
            number,
            projectDirectory,
            existing,
          }),
      })
  }, [access, projectDirectory, threadId, views])
}
