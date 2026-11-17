import 'reflect-metadata'

import { Module, type DynamicModule } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AddressInfo } from 'node:net'

import { FakeTimers } from '../../stream/__tests__/fake-timers'
import { MemoryStreamAuth } from '../../stream/memory-stream-auth'
import { StreamService } from '../../stream/stream-service'
import {
  AGENT_HOST_ENV,
  MCP_OAUTH_BEGIN,
  MCP_OAUTH_CALLBACK,
  OPERATOR_ANSWERS,
  STREAM,
  STREAM_AUTH,
} from '../../host/tokens'
import type { CallbackHandler } from '../../mcp-oauth/callback'
import { BearerAuthGuard } from '../bearer-auth.guard'
import { configureHttp } from '../configure-http'
import { HealthController } from '../health.controller'
import { McpOauthController } from '../mcp-oauth.controller'
import { OperatorRequestsController } from '../operator-requests.controller'
import { OriginGuard } from '../origin.guard'
import { StreamUpgradeController } from '../stream-upgrade.controller'

export const TOKEN = 'tok-a'
export const USER = 'user-a'
export const TRUSTED_ORIGIN = 'https://byatlas.io'
export const AUTHORIZE_URL = 'https://auth.example.com/authorize?state=1'

export type HttpFakes = {
  answered: Array<{ userId: string; body: unknown }>
  begun: Array<{ userId: string; body: unknown }>
}

export type RunningHttpApp = {
  url: string
  fakes: HttpFakes
  drain(): Promise<void>
  close(): Promise<void>
}

const answersOf = (fakes: HttpFakes) => ({
  answer: async (input: { userId: string; body: unknown }) => {
    fakes.answered.push({ userId: input.userId, body: input.body })
    return { status: 200, body: {} }
  },
})

const beginsOf = (fakes: HttpFakes) => ({
  begin: async (input: { userId: string; body: unknown }) => {
    fakes.begun.push({ userId: input.userId, body: input.body })
    return { status: 200, body: { url: AUTHORIZE_URL } }
  },
})

const callbackOf: CallbackHandler = async (query) =>
  query.get('state') === null
    ? { kind: 'page', html: '<p>connected</p>' }
    : { kind: 'redirect', location: `${TRUSTED_ORIGIN}/settings/integrations?mcpOauth=connected` }

@Module({})
class HttpTestModule {
  static forEnv(args: {
    trustedOrigins: string[]
    fakes: HttpFakes
    stream: StreamService
    streamAuth: MemoryStreamAuth
  }): DynamicModule {
    return {
      module: HttpTestModule,
      controllers: [
        HealthController,
        StreamUpgradeController,
        OperatorRequestsController,
        McpOauthController,
      ],
      providers: [
        { provide: AGENT_HOST_ENV, useValue: { trustedOrigins: args.trustedOrigins } },
        { provide: STREAM, useValue: args.stream },
        { provide: STREAM_AUTH, useValue: args.streamAuth },
        { provide: OPERATOR_ANSWERS, useValue: answersOf(args.fakes) },
        { provide: MCP_OAUTH_BEGIN, useValue: beginsOf(args.fakes) },
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
  const fakes: HttpFakes = { answered: [], begun: [] }
  const streamAuth = new MemoryStreamAuth({ now: () => 0 })
  streamAuth.grant({ token: TOKEN, userId: USER, expiresAt: 3_600_000 })
  const stream = new StreamService({
    auth: streamAuth,
    trustedOrigins: args.trustedOrigins,
    timers: new FakeTimers(),
    eventTypes: [],
  })
  const app = await NestFactory.create<NestExpressApplication>(
    HttpTestModule.forEnv({ trustedOrigins: args.trustedOrigins, fakes, stream, streamAuth }),
    { logger: false },
  )
  configureHttp(app, { trustedOrigins: args.trustedOrigins })
  await app.listen(0)
  return {
    url: `http://127.0.0.1:${portOf(app)}`,
    fakes,
    drain: () => stream.drain({}),
    close: async () => {
      await app.close()
    },
  }
}
