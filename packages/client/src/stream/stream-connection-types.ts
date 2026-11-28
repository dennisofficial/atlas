import type { PluginViewFold, RecordEvent } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { EStreamConnectionState } from './connection-machine'
import type { SessionFollower } from './session-follower'
import type { FollowedSessionList } from './sessions-list'
import type {
  FollowArgs,
  StreamNetworkSignal,
  StreamScheduler,
  StreamTransport,
} from './stream-ports'

export type StreamConnectionArgs = {
  transport: StreamTransport
  scheduler: StreamScheduler
  networkSignal?: StreamNetworkSignal | undefined
  eventSchema?: z.ZodType<RecordEvent> | undefined
  knownEventTypes?: ReadonlySet<string> | undefined
  views?: readonly PluginViewFold[] | undefined
}

export type FollowedSession = SessionFollower & { close(): void }

export type StreamConnection = {
  follow(args: FollowArgs): FollowedSession
  followSessions(): FollowedSessionList
  connect(): void
  reconnect(): void
  close(): void
  state(): EStreamConnectionState
}
