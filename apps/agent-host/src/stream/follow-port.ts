import { readSessionStatus, type ChangeFeed } from '@dltech/atlas-control'

import { FollowSession } from './follow-session'
import type { FollowDeps, FollowTarget, SubscriptionIndex } from './follow-types'
import type { LiveSource } from './live-source'
import { LiveOverlay } from './overlay/live-overlay'
import { SessionsListIndex } from './sessions-list'
import { StatusViews } from './status-views'
import type { SubscriptionPort } from './subscription-port'

export type FollowSubscriptions = SubscriptionPort & { close(): void }

export const createFollowSubscriptions = (
  args: FollowDeps & { feed: ChangeFeed; live?: LiveSource | undefined },
): FollowSubscriptions => {
  const { plane, timers, log } = args
  const overlay =
    args.live === undefined
      ? undefined
      : new LiveOverlay({
          source: args.live,
          timers,
          log,
          onFrameWhileDead: (sessionId) => statusViews.recheck(sessionId),
        })
  const statusViews: StatusViews = new StatusViews({
    read: ({ sessionId, threadId }) =>
      readSessionStatus({ plane, sessionId, threadId, now: new Date(timers.now()).toISOString() }),
    timers,
    log,
    onLiveness: (liveness) => overlay?.liveness(liveness),
  })
  const sessions = new SessionsListIndex({ plane, timers, log })
  const bySession = new Map<string, Set<FollowTarget>>()
  const index: SubscriptionIndex = {
    add: (subscription) => {
      const set = bySession.get(subscription.sessionId) ?? new Set()
      set.add(subscription)
      bySession.set(subscription.sessionId, set)
      statusViews.add(subscription)
      overlay?.add(subscription)
    },
    remove: (subscription) => {
      const set = bySession.get(subscription.sessionId)
      set?.delete(subscription)
      if (set?.size === 0) bySession.delete(subscription.sessionId)
      statusViews.remove(subscription)
      overlay?.remove(subscription)
    },
    resnap: (subscription) => overlay?.resnap(subscription),
    drained: (subscription) => overlay?.drained(subscription),
  }
  const offChange = args.feed.onChange((change) => {
    for (const target of [...(bySession.get(change.sessionId) ?? [])]) target.handleChange(change)
    statusViews.handleChange(change)
    sessions.handleChange(change)
  })
  const offGap = args.feed.onGap(() => {
    for (const targets of [...bySession.values()]) {
      for (const target of [...targets]) target.markDirty()
    }
    statusViews.refreshAll()
    sessions.handleGap()
  })
  const deps: FollowDeps = { plane, timers, log }
  return {
    open: (connection) => new FollowSession({ connection, deps, index, sessions }),
    close: () => {
      offChange()
      offGap()
      statusViews.close()
      sessions.close()
      overlay?.close()
    },
  }
}
