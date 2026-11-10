import { createDb, type Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'
import { eventTypesOf } from '@dltech/atlas-plugin-sdk'

import type { AgentHostEnv } from '../config/env'
import { SecretCipher } from '../config/secret-cipher'
import { mcpOauthBeginOf, mcpOauthCallbackOf, mcpOauthGatewayOf } from '../mcp-oauth'
import { registeredPlugins } from '../registered-plugins'
import { createPgStreamAuth } from '../stream/pg-stream-auth'
import type { SubscriptionPort } from '../stream/subscription-port'
import { startStreamServer, type StreamServer } from '../stream/stream-server'
import { systemHostTimers } from '../stream/system-timers'

const WEB_ORIGIN_FALLBACK = 'https://byatlas.io'

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
    const db = createDb(this.args.pool)
    const cipher = new SecretCipher(this.args.env.secretsEncryptionKey)
    const auth = createPgStreamAuth({ pool: this.args.pool })
    const server = startStreamServer({
      mcpOauthBegin: mcpOauthBeginOf({
        db,
        cipher,
        gateway: mcpOauthGatewayOf({ db, cipher, publicUrl: this.args.env.publicUrl }),
        resolve: (bearer) => auth.resolve(bearer),
        trustedOrigins: this.args.env.trustedOrigins,
      }),
      mcpOauthCallback: mcpOauthCallbackOf({
        db,
        cipher,
        webOrigin: this.args.env.trustedOrigins[0] ?? WEB_ORIGIN_FALLBACK,
      }),
      port: this.args.env.port,
      auth,
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
