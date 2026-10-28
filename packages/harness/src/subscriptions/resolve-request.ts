import { sameTarget, type JsonValue, type Subscription, type ThreadId } from '@dltech/atlas-core'

import type { ResolvedTarget, SubscriptionProvider } from './provider'
import type { ThreadKinds } from './thread-owner'

export type ResolvedRequest = {
  provider: SubscriptionProvider
  owner: ThreadId
  resolved: ResolvedTarget
}

export async function resolveRequest({
  providers,
  owners,
  request,
}: {
  providers: ReadonlyMap<string, SubscriptionProvider>
  owners: ThreadKinds
  request: { threadId: ThreadId; provider: string; input: string; projectDirectory: string }
}): Promise<ResolvedRequest | { error: string }> {
  const provider = providers.get(request.provider)
  if (provider === undefined) {
    const kinds = [...providers.keys()].join(', ')
    return {
      error: `Unknown subscription provider "${request.provider}". Available: ${kinds.length === 0 ? 'none' : kinds}.`,
    }
  }

  const resolved = await provider.resolve({
    input: request.input,
    threadId: request.threadId,
    projectDirectory: request.projectDirectory,
  })
  if ('error' in resolved) return resolved

  return { provider, resolved, owner: await owners.ownerOf({ threadId: request.threadId }) }
}

export function findExisting({
  subscriptions,
  owner,
  provider,
  target,
}: {
  subscriptions: Iterable<Subscription>
  owner: ThreadId
  provider: string
  target: JsonValue
}): Subscription | undefined {
  for (const candidate of subscriptions) {
    if (
      candidate.threadId === owner &&
      candidate.provider === provider &&
      sameTarget(candidate.target, target)
    )
      return candidate
  }
  return undefined
}
