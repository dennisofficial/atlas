import { db } from '@dltech/atlas-db'

import {
  activePullRequestSubscription,
  teammateThreadIds,
  threadsSubscriptions,
} from '../../platform/sessions/thread-subscriptions'

export async function sessionHoldsSubscription(args: {
  threadIds: readonly string[]
  repoFullName: string
  prNumber: number
}): Promise<Set<string>> {
  const teammates = await teammateThreadIds({ reader: db, threadIds: args.threadIds })
  const byThread = await threadsSubscriptions({
    reader: db,
    threadIds: [...args.threadIds, ...[...teammates.values()].flat()],
  })
  const holds = (threadId: string): boolean =>
    activePullRequestSubscription({
      subscriptions: byThread.get(threadId) ?? [],
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    }) !== undefined

  return new Set(
    args.threadIds.filter((threadId) => [threadId, ...(teammates.get(threadId) ?? [])].some(holds)),
  )
}
