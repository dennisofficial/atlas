import 'reflect-metadata'

import { Module, type DynamicModule } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AddressInfo } from 'node:net'

import { FakeTimers } from '../../stream/__tests__/fake-timers'
import { MemoryStreamAuth } from '../../stream/memory-stream-auth'
import { StreamService } from '../../stream/stream-service'
import { AGENT_HOST_ENV, MCP_OAUTH_CALLBACK, STREAM, STREAM_AUTH } from '../../host/tokens'
import type { CallbackHandler } from '../../mcp-oauth/callback'
import { BearerAuthGuard } from '../bearer-auth.guard'
import { configureHttp } from '../configure-http'
import { HealthController } from '../health.controller'
import { McpOauthCallbackController } from '../mcp-oauth.controller'
import { OriginGuard } from '../origin.guard'
import { StreamUpgradeController } from '../stream-upgrade.controller'

export const TOKEN = 'tok-a'
export const USER = 'user-a'
export const TRUSTED_ORIGIN = 'https://byatlas.io'

export type RunningHttpApp = {
  url: string
  drain(): Promise<void>
  close(): Promise<void>
}

const callbackOf: CallbackHandler = async (query) =>
  query.get('state') === null
    ? { kind: 'page', html: '<p>connected</p>' }
    : { kind: 'redirect', location: `${TRUSTED_ORIGIN}/settings/integrations?mcpOauth=connected` }

@Module({})
class HttpTestModule {
  static forEnv(args: {
    trustedOrigins: string[]
    stream: StreamService
    streamAuth: MemoryStreamAuth
  }): DynamicModule {
    return {
      module: HttpTestModule,
      controllers: [HealthController, StreamUpgradeController, McpOauthCallbackController],
      providers: [
        { provide: AGENT_HOST_ENV, useValue: { trustedOrigins: args.trustedOrigins } },
        { provide: STREAM, useValue: args.stream },
        { provide: STREAM_AUTH, useValue: args.streamAuth },
        { provide: MCP_OAUTH_CALLBACK, useValue: callbackOf },
        OriginGuard,
        BearerAuthGuard,
      ],
    }
  }
}

const portOf = (app: NestExpressApplication): number => {
  const server: { address(): AddressInfo | string | null } = app.getHttpServer()
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the http app has no port')
  return address.port
}

export const startHttpApp = async (args: { trustedOrigins: string[] }): Promise<RunningHttpApp> => {
  const streamAuth = new MemoryStreamAuth({ now: () => 0 })
  streamAuth.grant({ token: TOKEN, userId: USER, expiresAt: 3_600_000 })
  const stream = new StreamService({
    auth: streamAuth,
    trustedOrigins: args.trustedOrigins,
    timers: new FakeTimers(),
    eventTypes: [],
  })
  const app = await NestFactory.create<NestExpressApplication>(
    HttpTestModule.forEnv({ trustedOrigins: args.trustedOrigins, stream, streamAuth }),
    { logger: false },
  )
  configureHttp(app, { trustedOrigins: args.trustedOrigins })
  await app.listen(0)
  return {
    url: `http://127.0.0.1:${portOf(app)}`,
    drain: () => stream.drain({}),
    close: async () => {
      await app.close()
    },
  }
}
