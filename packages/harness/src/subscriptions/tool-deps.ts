import type { ThreadId } from '@dltech/atlas-core'

import type { SubscriptionRegistryPort } from './port'
import type { ThreadKinds } from './thread-owner'

export type SubscriptionToolDeps = {
  registry: () => SubscriptionRegistryPort
  owners: ThreadKinds
  now?: (() => number) | undefined
}

export const ownedBy = async ({
  deps,
  threadId,
}: {
  deps: SubscriptionToolDeps
  threadId: ThreadId
}) => {
  const owner = await deps.owners.ownerOf({ threadId })
  return deps
    .registry()
    .list()
    .filter((subscription) => subscription.threadId === owner)
}
