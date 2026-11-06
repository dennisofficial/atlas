import { MCP_OAUTH_CALLBACK_PATH } from '@dltech/atlas-wire'
import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { RefreshLockModule } from '../../../_lib/refresh-lock/refresh-lock.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { McpOauthAccessService } from './mcp-oauth-access.service'
import { McpOauthCallbackController } from './mcp-oauth-callback.controller'
import { McpOauthRouter } from './mcp-oauth.router'
import { McpOauthService } from './mcp-oauth.service'
import { McpOauthClock, McpOauthConfig, McpOauthFetcher, McpOauthStore } from './mcp-oauth.types'
import { PrismaMcpOauthStore } from './prisma-mcp-oauth.store'

@Module({
  imports: [SessionsModule, RefreshLockModule],
  controllers: [McpOauthCallbackController],
  providers: [
    McpOauthService,
    McpOauthAccessService,
    McpOauthRouter,
    { provide: McpOauthStore, useClass: PrismaMcpOauthStore },
    {
      provide: McpOauthClock,
      useValue: { now: () => Date.now() },
    },
    {
      provide: McpOauthFetcher,
      useValue: {
        fetch: (input: string, init?: RequestInit) => fetch(input, init),
      },
    },
    {
      provide: McpOauthConfig,
      inject: [EnvService],
      useFactory: (env: EnvService): McpOauthConfig => ({
        redirectUri: `${env.get('WEB_ORIGIN').replace(/\/$/, '')}${MCP_OAUTH_CALLBACK_PATH}`,
        webOrigin: env.get('WEB_ORIGIN'),
        allowLocalTargets: env.get('APP_TIER') === 'local',
      }),
    },
  ],
})
export class McpOauthModule {}
