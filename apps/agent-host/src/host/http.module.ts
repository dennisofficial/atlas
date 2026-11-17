import { Module, type Provider } from '@nestjs/common'
import type { Db, Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { mcpOauthCallbackOf } from '../mcp-oauth/callback'
import type { SecretCipher } from '../config/secret-cipher'
import { createPgStreamAuth } from '../stream/pg-stream-auth'
import { BearerAuthGuard } from '../http/bearer-auth.guard'
import { HealthController } from '../http/health.controller'
import { McpOauthCallbackController } from '../http/mcp-oauth.controller'
import { OriginGuard } from '../http/origin.guard'
import { StreamUpgradeController } from '../http/stream-upgrade.controller'
import { CoreModule } from './core.module'
import { StreamModule } from './stream.module'
import { AGENT_HOST_ENV, CIPHER, DB, MCP_OAUTH_CALLBACK, POOL, STREAM_AUTH } from './tokens'

const WEB_ORIGIN_FALLBACK = 'https://byatlas.io'

const streamAuthProvider: Provider = {
  provide: STREAM_AUTH,
  useFactory: (pool: Pool) => createPgStreamAuth({ pool }),
  inject: [POOL],
}

const mcpOauthCallbackProvider: Provider = {
  provide: MCP_OAUTH_CALLBACK,
  useFactory: (db: Db, cipher: SecretCipher, env: AgentHostEnv) =>
    mcpOauthCallbackOf({
      db,
      cipher,
      webOrigin: env.trustedOrigins[0] ?? WEB_ORIGIN_FALLBACK,
    }),
  inject: [DB, CIPHER, AGENT_HOST_ENV],
}

@Module({
  imports: [CoreModule, StreamModule],
  controllers: [HealthController, StreamUpgradeController, McpOauthCallbackController],
  providers: [streamAuthProvider, mcpOauthCallbackProvider, OriginGuard, BearerAuthGuard],
})
export class HttpModule {}
