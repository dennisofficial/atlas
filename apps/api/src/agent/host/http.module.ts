import { Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'

import type { AgentHostEnv } from '../config/env'
import { mcpOauthCallbackOf } from '../mcp-oauth/callback'
import { mcpOauthStartOf } from '../mcp-oauth/start'
import { BrowserReturnService } from '../browser-return/service'
import { BrowserReturnController } from '../browser-return/controller'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { DaemonBundleController } from '../http/daemon-bundle.controller'
import { HealthController } from '../http/health.controller'
import { McpOauthCallbackController } from '../http/mcp-oauth.controller'
import { CoreModule } from './core.module'
import {
  AGENT_HOST_ENV,
  BROWSER_RETURN,
  CIPHER,
  DB,
  MCP_OAUTH_CALLBACK,
  MCP_OAUTH_START,
} from './tokens'

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

const mcpOauthStartProvider: Provider = {
  provide: MCP_OAUTH_START,
  useFactory: (db: Db, cipher: SecretCipher) => mcpOauthStartOf({ db, cipher }),
  inject: [DB, CIPHER],
}

const browserReturnProvider: Provider = {
  provide: BROWSER_RETURN,
  useFactory: (db: Db, cipher: SecretCipher, env: AgentHostEnv) =>
    new BrowserReturnService({
      db,
      cipher,
      publicUrl: env.publicUrl,
      webOrigin: env.trustedOrigins[0] ?? WEB_ORIGIN_FALLBACK,
    }),
  inject: [DB, CIPHER, AGENT_HOST_ENV],
}

@Module({
  imports: [CoreModule],
  controllers: [
    HealthController,
    DaemonBundleController,
    McpOauthCallbackController,
    BrowserReturnController,
  ],
  providers: [mcpOauthCallbackProvider, mcpOauthStartProvider, browserReturnProvider],
})
export class HttpModule {}
