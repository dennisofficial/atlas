import { EMPTY_SUBSCRIPTIONS, prStatesWireSchema, rosterWireSchema } from '@dltech/atlas-wire'

import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'

import { createBroadcastEncoder, sendFrame } from './frame-egress'
import { subscriptionsSnapshot } from './serve-subscription-requests'
import type { SessionHandlersArgs, SessionSocket } from './socket-session-types'
import type { ServePrStates, ServeRoster } from './serve-app'
import { createStepAliaser, endsAliasedStep, retagged } from './step-alias'

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

/** An aliased socket's frames are retagged to the step it resumed mid-flight, all others pass through. */
export const retagForSocket = (args: { socket: SessionSocket; frame: ServeFrame }): ServeFrame => {
  const alias = args.socket.data.alias
  if (alias === null) return args.frame

  const frame = retagged({ frame: args.frame, alias })
  if (endsAliasedStep({ frame: args.frame, alias })) args.socket.data.alias = null
  return frame
}

export function createBroadcast(args: {
  attached: Set<SessionSocket>
  deferred: { replay: () => void }
  aliaser: ReturnType<typeof createStepAliaser>
}): (frame: ServeFrame) => void {
  return (frame) => {
    const encodedFor = createBroadcastEncoder(frame)
    for (const socket of args.attached) {
      if (socket.data.alias === null) {
        socket.send(encodedFor(socket))
        continue
      }
      sendFrame({ socket, frame: retagForSocket({ socket, frame }) })
    }
    if (frame.kind === EServeFrame.Checkpoint) args.deferred.replay()
  }
}
