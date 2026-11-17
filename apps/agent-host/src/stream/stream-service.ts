import type { HostTimers } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { StreamSocketPort } from './socket-port'
import type { StreamAuthPort } from './stream-auth'
import { StreamConnection, type UserSlots } from './stream-connection'
import {
  EStreamServerClose,
  STREAM_DRAIN_RECONNECT_SPREAD_MS,
  STREAM_DRAIN_TIMEOUT_MS,
  STREAM_MAX_CONNECTIONS_PER_USER,
} from './stream-limits'
import { unimplementedSubscriptions, type SubscriptionPort } from './subscription-port'
import { systemHostTimers } from './system-timers'
import { createUserSlots } from './user-slots'

export const STREAM_PATH = '/stream'

export type StreamRefusal = { status: number; message: string }

export type StreamStartArgs = { subscriptions: SubscriptionPort }

export type StreamServiceArgs = {
  auth: StreamAuthPort
  trustedOrigins: readonly string[]
  timers?: HostTimers | undefined
  eventTypes?: readonly string[] | undefined
  maxConnectionsPerUser?: number
  log?: LogPort | undefined
}

export class StreamService {
  private subscriptions: SubscriptionPort = unimplementedSubscriptions
  private readonly timers: HostTimers
  private readonly users: UserSlots
  private readonly sockets = new Set<StreamConnection>()
  private draining = false
  private emptied: (() => void) | undefined

  constructor(private readonly args: StreamServiceArgs) {
    this.timers = args.timers ?? systemHostTimers
    this.users = createUserSlots({
      limit: args.maxConnectionsPerUser ?? STREAM_MAX_CONNECTIONS_PER_USER,
    })
  }

  start(args: StreamStartArgs): void {
    this.subscriptions = args.subscriptions
  }

  connections(): number {
    return this.sockets.size
  }

  isDraining(): boolean {
    return this.draining
  }

  refusal(args: { origin: string | undefined }): StreamRefusal | undefined {
    if (this.draining) return { status: 503, message: 'draining' }
    if (!this.originAllowed(args.origin)) return { status: 403, message: 'forbidden' }
    return undefined
  }

  open(socket: StreamSocketPort): StreamConnection {
    const connection = new StreamConnection(socket, {
      auth: this.args.auth,
      subscriptions: this.subscriptions,
      timers: this.timers,
      users: this.users,
      eventTypes: this.args.eventTypes,
      log: this.args.log,
      onClosed: (closed) => this.closed(closed),
    })
    this.sockets.add(connection)
    return connection
  }

  async drain(args: { reconnectAfterMs?: number }): Promise<void> {
    this.draining = true
    for (const connection of [...this.sockets]) {
      connection.goAway(
        args.reconnectAfterMs ??
          Math.floor(this.timers.random() * STREAM_DRAIN_RECONNECT_SPREAD_MS),
      )
    }
    await this.waitUntilEmpty()
  }

  async stop(): Promise<void> {
    this.draining = true
    for (const connection of [...this.sockets]) {
      connection.close(EStreamServerClose.InternalError)
    }
  }

  private originAllowed(origin: string | undefined): boolean {
    const trusted = this.args.trustedOrigins
    if (trusted.length === 0) return true
    return origin === undefined || trusted.includes(origin)
  }

  private closed(connection: StreamConnection): void {
    this.sockets.delete(connection)
    if (this.sockets.size === 0) this.emptied?.()
  }

  private waitUntilEmpty(): Promise<void> {
    if (this.sockets.size === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.emptied = undefined
        resolve()
      }
      const timer = setTimeout(done, STREAM_DRAIN_TIMEOUT_MS)
      this.emptied = done
    })
  }
}
