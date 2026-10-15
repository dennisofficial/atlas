import type { ThreadId } from '@dltech/atlas-core'

import { checkoutKey, type RepositoryCheckout } from './pure'
import type { PullRequestService } from './pull-request-service'
import { IDENTITY_THREAD_KINDS, type ThreadKinds } from './thread-kinds'

export type FamilyTracker = {
  /** Whether this thread's place actually changed; an unchanged place touches the service not at all. */
  place: (args: { threadId: ThreadId; checkout: RepositoryCheckout | null }) => boolean
  adopt: (args: { from: ThreadId; to: ThreadId }) => void
  show: (args: { threadId: ThreadId }) => void
  hasVisibleThread: () => boolean
  checkoutFor: (args: { threadId: ThreadId }) => RepositoryCheckout | null
  threadsOn: (args: { key: string }) => readonly ThreadId[]
  /**
   * The threads a notice for this checkout belongs to: `threadsOn` with every subagent replaced by
   * its nearest main or teammate ancestor. A subagent shares its spawner's checkout and must never
   * be woken by a PR event meant for the conversation that owns the work.
   */
  threadsOwning: (args: { key: string }) => Promise<readonly ThreadId[]>
  ownerOf: ThreadKinds['ownerOf']
}

const same = (left: RepositoryCheckout | undefined, right: RepositoryCheckout | null): boolean => {
  if (left === undefined || right === null) return left === undefined && right === null

  return left.directory === right.directory && checkoutKey(left) === checkoutKey(right)
}

/**
 * Each thread of the session family stands in one place at a time. The service is handed the union
 * of those places whenever any of them moves, and reconciles it — so a thread leaving a worktree
 * drops that checkout only when no other thread still stands on it.
 */
export function createFamilyTracker(args: {
  service: PullRequestService
  threadKinds?: ThreadKinds
}): FamilyTracker {
  const threadKinds = args.threadKinds ?? IDENTITY_THREAD_KINDS
  const places = new Map<ThreadId, RepositoryCheckout>()
  let visibleThread: ThreadId | null = null

  const sync = (): void => {
    const visible = visibleThread === null ? undefined : (places.get(visibleThread) ?? null)
    args.service.track({
      checkouts: [...places.values()],
      ...(visible === undefined ? {} : { visible }),
    })
  }

  return {
    place: ({ threadId, checkout }) => {
      if (same(places.get(threadId), checkout)) return false

      if (checkout === null) places.delete(threadId)
      else places.set(threadId, checkout)
      sync()
      return true
    },
    adopt: ({ from, to }) => {
      const held = places.get(from)
      if (held !== undefined && !places.has(to)) {
        places.delete(from)
        places.set(to, held)
      }
      if (visibleThread === from) visibleThread = to
      sync()
    },
    show: ({ threadId }) => {
      if (visibleThread === threadId) return

      visibleThread = threadId
      sync()
    },
    hasVisibleThread: () => visibleThread !== null,
    checkoutFor: ({ threadId }) => places.get(threadId) ?? null,
    threadsOn: ({ key }) =>
      [...places].filter(([, checkout]) => checkoutKey(checkout) === key).map(([threadId]) => threadId),
    threadsOwning: async ({ key }) => {
      const standing = [...places]
        .filter(([, checkout]) => checkoutKey(checkout) === key)
        .map(([threadId]) => threadId)
      const owners = await Promise.all(standing.map((threadId) => threadKinds.ownerOf({ threadId })))
      return [...new Set(owners)]
    },
    ownerOf: threadKinds.ownerOf,
  }
}
