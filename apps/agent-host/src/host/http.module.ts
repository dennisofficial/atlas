import { Module, type Provider } from '@nestjs/common'
import type { Db, Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { mcpOauthCallbackOf } from '../mcp-oauth/callback'
import { operatorRequestRegistry } from '../config/operator-control'
import { McpOauthBeginService } from '../mcp-oauth/begin-service'
import { mcpOauthGatewayOf } from '../mcp-oauth/gateway'
import { OperatorAnswerService } from '../operator-input/answer-service'
import type { SecretCipher } from '../config/secret-cipher'
import { createPgStreamAuth } from '../stream/pg-stream-auth'
import { BearerAuthGuard } from '../http/bearer-auth.guard'
import { HealthController } from '../http/health.controller'
import { McpOauthController } from '../http/mcp-oauth.controller'
import { OperatorRequestsController } from '../http/operator-requests.controller'
import { OriginGuard } from '../http/origin.guard'
import { StreamUpgradeController } from '../http/stream-upgrade.controller'
import { CoreModule } from './core.module'
import { StreamModule } from './stream.module'
import {
  AGENT_HOST_ENV,
  CIPHER,
  DB,
  LOG,
  MCP_OAUTH_BEGIN,
  MCP_OAUTH_CALLBACK,
  OPERATOR_ANSWERS,
  POOL,
  STREAM_AUTH,
} from './tokens'

const WEB_ORIGIN_FALLBACK = 'https://byatlas.io'

const streamAuthProvider: Provider = {
  provide: STREAM_AUTH,
  useFactory: (pool: Pool) => createPgStreamAuth({ pool }),
  inject: [POOL],
}

const operatorAnswersProvider: Provider = {
  provide: OPERATOR_ANSWERS,
  useFactory: (log: LogPort): OperatorAnswerService =>
    new OperatorAnswerService({ registry: operatorRequestRegistry(), log }),
  inject: [LOG],
}

const mcpOauthBeginProvider: Provider = {
  provide: MCP_OAUTH_BEGIN,
  useFactory: (db: Db, cipher: SecretCipher, env: AgentHostEnv): McpOauthBeginService =>
    new McpOauthBeginService({
      db,
      cipher,
      gateway: mcpOauthGatewayOf({ db, cipher, publicUrl: env.publicUrl }),
    }),
  inject: [DB, CIPHER, AGENT_HOST_ENV],
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
  controllers: [
    HealthController,
    StreamUpgradeController,
    OperatorRequestsController,
    McpOauthController,
  ],
  providers: [
    streamAuthProvider,
    operatorAnswersProvider,
    mcpOauthBeginProvider,
    mcpOauthCallbackProvider,
    OriginGuard,
    BearerAuthGuard,
  ],
})
export class HttpModule {}
