import { pricedView, type ChangeFeed } from '@dltech/atlas-control'

import { FollowSession } from './follow-session'
import type { FollowDeps, FollowTarget, SubscriptionIndex } from './follow-types'
import type { LiveSource } from './live-source'
import { LiveOverlay } from './overlay/live-overlay'
import { SessionsListIndex } from './sessions-list'
import { SessionViews } from './session-views'
import { sharedReads } from './shared-reads'
import type { SubscriptionPort } from './subscription-port'

export type FollowSubscriptions = SubscriptionPort & { close(): void }

export const createFollowSubscriptions = (
  args: FollowDeps & { feed: ChangeFeed; live?: LiveSource | undefined },
): FollowSubscriptions => {
  const { timers, log } = args
  const plane = sharedReads(args.plane)
  const overlay =
    args.live === undefined
      ? undefined
      : new LiveOverlay({
          source: args.live,
          timers,
          log,
          onFrameWhileDead: (sessionId) => sessionViews.recheck(sessionId),
        })
  const sessionViews: SessionViews = new SessionViews({
    read: async ({ sessionId, threadId }) =>
      pricedView(await plane.readSessionView({ sessionId, threadId })),
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
      sessionViews.add(subscription)
      overlay?.add(subscription)
    },
    remove: (subscription) => {
      const set = bySession.get(subscription.sessionId)
      set?.delete(subscription)
      if (set?.size === 0) bySession.delete(subscription.sessionId)
      sessionViews.remove(subscription)
      overlay?.remove(subscription)
    },
    resnap: (subscription) => overlay?.resnap(subscription),
    drained: (subscription) => overlay?.drained(subscription),
  }
  const offChange = args.feed.onChange((change) => {
    for (const target of [...(bySession.get(change.sessionId) ?? [])]) target.handleChange(change)
    sessionViews.handleChange(change)
    sessions.handleChange(change)
  })
  const offGap = args.feed.onGap(() => {
    for (const targets of [...bySession.values()]) {
      for (const target of [...targets]) target.markDirty()
    }
    sessionViews.refreshAll()
    sessions.handleGap()
  })
  const deps: FollowDeps = {
    plane,
    timers,
    log,
    ...(args.recordSurface === undefined ? {} : { recordSurface: args.recordSurface }),
  }
  return {
    open: (connection) => new FollowSession({ connection, deps, index, sessions }),
    close: () => {
      offChange()
      offGap()
      sessionViews.close()
      sessions.close()
      overlay?.close()
    },
  }
}
