import { Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'

import type { AgentHostEnv } from '../config/env'
import { mcpOauthCallbackOf } from '../mcp-oauth/callback'
import type { SecretCipher } from '../config/secret-cipher'
import { DaemonBundleController } from '../http/daemon-bundle.controller'
import { HealthController } from '../http/health.controller'
import { McpOauthCallbackController } from '../http/mcp-oauth.controller'
import { CoreModule } from './core.module'
import { AGENT_HOST_ENV, CIPHER, DB, MCP_OAUTH_CALLBACK } from './tokens'

const WEB_ORIGIN_FALLBACK = 'https://byatlas.io'

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
  imports: [CoreModule],
  controllers: [HealthController, DaemonBundleController, McpOauthCallbackController],
  providers: [mcpOauthCallbackProvider],
})
export class HttpModule {}
