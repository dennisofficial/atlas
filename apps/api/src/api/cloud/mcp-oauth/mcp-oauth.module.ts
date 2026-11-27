import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { RefreshLockModule } from '../../../_lib/refresh-lock/refresh-lock.module'
import { McpOauthAccessService } from './mcp-oauth-access.service'
import { McpOauthRouter } from './mcp-oauth.router'
import { McpOauthService } from './mcp-oauth.service'
import { McpOauthClock, McpOauthConfig, McpOauthFetcher, McpOauthStore } from './mcp-oauth.types'
import { PrismaMcpOauthStore } from './prisma-mcp-oauth.store'

@Module({
  imports: [RefreshLockModule],
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
        allowLocalTargets: env.get('APP_TIER') === 'local',
      }),
    },
  ],
})
export class McpOauthModule {}
