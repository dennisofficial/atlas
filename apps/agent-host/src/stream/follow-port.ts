import type { ChangeFeed } from '@dltech/atlas-control'

import { FollowSession } from './follow-session'
import type { FollowDeps, FollowTarget, SubscriptionIndex } from './follow-types'
import type { SubscriptionPort } from './subscription-port'

export type FollowSubscriptions = SubscriptionPort & { close(): void }

export const createFollowSubscriptions = (
  args: FollowDeps & { feed: ChangeFeed },
): FollowSubscriptions => {
  const bySession = new Map<string, Set<FollowTarget>>()
  const index: SubscriptionIndex = {
    add: (subscription) => {
      const set = bySession.get(subscription.sessionId) ?? new Set()
      set.add(subscription)
      bySession.set(subscription.sessionId, set)
    },
    remove: (subscription) => {
      const set = bySession.get(subscription.sessionId)
      set?.delete(subscription)
      if (set?.size === 0) bySession.delete(subscription.sessionId)
    },
  }
  const offChange = args.feed.onChange((change) => {
    for (const target of [...(bySession.get(change.sessionId) ?? [])]) target.handleChange(change)
  })
  const offGap = args.feed.onGap(() => {
    for (const targets of [...bySession.values()]) {
      for (const target of [...targets]) target.markDirty()
    }
  })
  const deps: FollowDeps = { plane: args.plane, timers: args.timers, log: args.log }
  return {
    open: (connection) => new FollowSession(connection, deps, index),
    close: () => {
      offChange()
      offGap()
    },
  }
}
