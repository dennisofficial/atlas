import { Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'

import type { AgentHostEnv } from '../config/env'
import { mcpOauthCallbackOf } from '../mcp-oauth/callback'
import { BrowserReturnService } from '../browser-return/service'
import { browserReturnsOf } from '../browser-return/from-env'
import { BrowserReturnController } from '../browser-return/controller'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { DaemonBundleController } from '../http/daemon-bundle.controller'
import { HealthController } from '../http/health.controller'
import { McpOauthCallbackController } from '../http/mcp-oauth.controller'
import { CoreModule } from './core.module'
import { AGENT_HOST_ENV, BROWSER_RETURN, CIPHER, DB, MCP_OAUTH_CALLBACK } from './tokens'

const mcpOauthCallbackProvider: Provider = {
  provide: MCP_OAUTH_CALLBACK,
  useFactory: (db: Db, cipher: SecretCipher, returns: BrowserReturnService) =>
    mcpOauthCallbackOf({ db, cipher, returns }),
  inject: [DB, CIPHER, BROWSER_RETURN],
}

const browserReturnProvider: Provider = {
  provide: BROWSER_RETURN,
  useFactory: (db: Db, cipher: SecretCipher, env: AgentHostEnv) =>
    browserReturnsOf({ db, cipher, env }),
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
  providers: [mcpOauthCallbackProvider, browserReturnProvider],
})
export class HttpModule {}
