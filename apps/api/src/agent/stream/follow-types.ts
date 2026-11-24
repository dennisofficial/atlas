import type { ControlPlane } from '@dltech/atlas-control'
import type { HostTimers } from '@dltech/atlas-host'
import type { LogPort, ProductAnalytics } from '@dltech/atlas-observability'
import type {
  EStreamSurface,
  SessionChange,
  SessionViewOutput,
  StreamServerMessage,
} from '@dltech/atlas-protocol'

import type { SubscriptionConnection } from './subscription-port'

export type FollowPlane = Pick<
  ControlPlane,
  | 'readSession'
  | 'readThread'
  | 'head'
  | 'readEvents'
  | 'readTailBase'
  | 'listSessionDigests'
  | 'readSessionView'
>

export type FollowDeps = {
  plane: FollowPlane
  timers: HostTimers
  log: LogPort | undefined
  analytics?: ProductAnalytics | undefined
  recordSurface?: ((args: SurfaceRecord) => void) | undefined
  viewHead?: ((args: { sessionId: string; headSeq: number }) => void) | undefined
}

export type SessionComputeReader = (args: {
  sessionId: string
}) => Promise<SessionViewOutput['compute']>

export type SurfaceRecord = {
  sessionId: string
  userId: string
  surface: EStreamSurface
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
  readonly isMainThread: boolean
  readonly liveKey: string
  readonly protocolVersion: number
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  handleChange(change: SessionChange): void
  markDirty(): void
}

export type FollowConnection = SubscriptionConnection
