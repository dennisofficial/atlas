import type { Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'
import { eventTypesOf } from '@dltech/atlas-plugin-sdk'

import type { AgentHostEnv } from '../config/env'
import { registeredPlugins } from '../registered-plugins'
import { createPgStreamAuth } from '../stream/pg-stream-auth'
import type { SubscriptionPort } from '../stream/subscription-port'
import { startStreamServer, type StreamServer } from '../stream/stream-server'
import { systemHostTimers } from '../stream/system-timers'

export type StreamServiceArgs = {
  env: AgentHostEnv
  pool: Pool
  log: LogPort
}

export type StreamStartArgs = {
  subscriptions: SubscriptionPort
}

export class StreamService {
  private server: StreamServer | undefined
  private readonly args: StreamServiceArgs

  constructor(args: StreamServiceArgs) {
    this.args = args
  }

  start(startArgs: StreamStartArgs): StreamServer {
    const server = startStreamServer({
      port: this.args.env.port,
      auth: createPgStreamAuth({ pool: this.args.pool }),
      subscriptions: startArgs.subscriptions,
      timers: systemHostTimers,
      eventTypes: eventTypesOf(registeredPlugins),
      trustedOrigins: this.args.env.trustedOrigins,
      log: this.args.log,
    })
    this.server = server
    return server
  }

  running(): StreamServer {
    if (this.server === undefined) throw new Error('the stream server has not started')
    return this.server
  }

  async stop(): Promise<void> {
    await this.server?.stop()
  }
}
