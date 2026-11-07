import type { ControlPlane } from '@dltech/atlas-control'
import type { HostTimers } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import type { SessionChange, StreamServerMessage } from '@dltech/atlas-protocol'

import type { SubscriptionConnection } from './subscription-port'

export type FollowPlane = Pick<
  ControlPlane,
  'readSession' | 'head' | 'readEvents' | 'listSessionDigests' | 'readSessionView'
>

export type FollowDeps = {
  plane: FollowPlane
  timers: HostTimers
  log: LogPort | undefined
}

export type SubscriptionIndex = {
  add(subscription: FollowTarget): void
  remove(subscription: FollowTarget): void
  resnap(subscription: FollowTarget): void
  drained(subscription: FollowTarget): void
}

export type FollowTarget = {
  readonly id: string
  readonly sessionId: string
  readonly threadId: string | undefined
  readonly protocolVersion: number
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  handleChange(change: SessionChange): void
  markDirty(): void
}

export type FollowConnection = SubscriptionConnection
