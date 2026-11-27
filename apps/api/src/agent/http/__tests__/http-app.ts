import 'reflect-metadata'

import { Module, type DynamicModule } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AddressInfo } from 'node:net'

import { BrowserReturnController } from '../../browser-return/controller'
import type { BrowserReturnService } from '../../browser-return/service'
import {
  BROWSER_RETURN,
  MCP_OAUTH_CALLBACK,
  MCP_OAUTH_START,
  SESSION_STREAM,
} from '../../host/tokens'
import type { CallbackHandler } from '../../mcp-oauth/callback'
import type { StartHandler } from '../../mcp-oauth/start'
import { createSessionStream, type SessionStream } from '../../stream/session-stream'
import { FakeTimers } from '../../stream/__tests__/fake-timers'
import { createUserSlots } from '../../stream/user-slots'
import { configureHttp } from '../configure-http'
import { HealthController } from '../health.controller'
import { McpOauthCallbackController } from '../mcp-oauth.controller'

export const TRUSTED_ORIGIN = 'https://byatlas.io'

export type RunningHttpApp = {
  url: string
  stream: SessionStream
  close(): Promise<void>
}

const callbackOf: CallbackHandler = async ({ query }) =>
  query.get('state') === null
    ? { kind: 'page', html: '<p>connected</p>' }
    : { kind: 'redirect', location: `${TRUSTED_ORIGIN}/settings/integrations?mcpOauth=connected` }

@Module({})
class HttpTestModule {
  static forEnv(args: { trustedOrigins: string[]; stream: SessionStream }): DynamicModule {
    return {
      module: HttpTestModule,
      controllers: [HealthController, McpOauthCallbackController, BrowserReturnController],
      providers: [
        { provide: SESSION_STREAM, useValue: args.stream },
        { provide: MCP_OAUTH_CALLBACK, useValue: callbackOf },
        { provide: MCP_OAUTH_START, useValue: startOf },
        { provide: BROWSER_RETURN, useValue: browserReturnOf },
      ],
    }
  }
}

const startOf: StartHandler = async ({ state, surface }) =>
  state === 'gone'
    ? { kind: 'gone', html: '<p>expired</p>' }
    : {
        kind: 'redirect',
        location: `https://provider.example/authorize?state=${state}`,
        cookie: `atlas_mcp_sign_in=${surface ?? 'none'}; Path=/mcp-oauth/callback; HttpOnly; Secure; SameSite=Lax`,
      }

const browserReturnOf: Pick<BrowserReturnService, 'start'> = {
  start: async ({ state, surface, port }) =>
    state === 'gone'
      ? { kind: 'gone', html: '<p>expired</p>' }
      : {
          kind: 'redirect',
          location: `https://provider.example/authorize?state=${state}`,
          cookie: `atlas_return=${surface ?? 'none'}:${port ?? 'none'}; Path=/mcp-oauth/callback; HttpOnly; Secure; SameSite=Lax`,
        },
}

const portOf = (app: NestExpressApplication): number => {
  const server: { address(): AddressInfo | string | null } = app.getHttpServer()
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the http app has no port')
  return address.port
}

export const startHttpApp = async (): Promise<RunningHttpApp> => {
  const stream = createSessionStream({
    users: createUserSlots({ limit: 4 }),
    timers: new FakeTimers(),
    eventTypes: [],
    log: undefined,
  })
  const app = await NestFactory.create<NestExpressApplication>(
    HttpTestModule.forEnv({ trustedOrigins: [TRUSTED_ORIGIN], stream }),
    { logger: false },
  )
  configureHttp(app, { trustedOrigins: [TRUSTED_ORIGIN] })
  await app.listen(0)
  return {
    url: `http://127.0.0.1:${portOf(app)}`,
    stream,
    close: async () => {
      await app.close()
    },
  }
}
