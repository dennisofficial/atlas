import { EMPTY_SUBSCRIPTIONS, prStatesWireSchema, rosterWireSchema } from '@dltech/atlas-wire'

import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'

import { createBroadcastEncoder } from './frame-egress'
import { subscriptionsSnapshot } from './serve-subscription-requests'
import type { SessionHandlersArgs, SessionSocket } from './socket-session-types'
import type { ServePrStates, ServeRoster } from './serve-app'

export function createSnapshotBroadcasts(args: {
  attached: Set<SessionSocket>
  snapshot: ServeRoster['snapshot']
  prStatesSnapshot: NonNullable<SessionHandlersArgs['prStates']>['snapshot']
  subscriptions?: SessionHandlersArgs['subscriptions']
}) {
  const { attached, snapshot, prStatesSnapshot, subscriptions } = args
  const tell = (frame: ServeFrame): void => {
    const encodedFor = createBroadcastEncoder(frame)
    for (const socket of attached) socket.send(encodedFor(socket))
  }
  return {
    broadcastRoster(): void {
      tell({ kind: EServeFrame.Roster, roster: rosterWireSchema.parse(snapshot()) })
    },
    broadcastPrStates(): void {
      tell({
        kind: EServeFrame.PrStates,
        states: prStatesWireSchema.parse({ states: prStatesSnapshot() }).states,
      })
    },
    broadcastSubscriptions(): void {
      tell({
        kind: EServeFrame.Subscriptions,
        ...(subscriptions === undefined
          ? EMPTY_SUBSCRIPTIONS
          : subscriptionsSnapshot(subscriptions)),
      })
    },
  }
}
