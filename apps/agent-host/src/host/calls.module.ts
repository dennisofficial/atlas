import { Global, Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { operatorRequestRegistry } from '../config/operator-control'
import { McpOauthBeginService } from '../mcp-oauth/begin-service'
import { mcpOauthGatewayOf } from '../mcp-oauth/gateway'
import { OperatorAnswerService } from '../operator-input/answer-service'
import type { SecretCipher } from '../config/secret-cipher'
import { CoreModule } from './core.module'
import { AGENT_HOST_ENV, CIPHER, DB, LOG, MCP_OAUTH_BEGIN, OPERATOR_ANSWERS } from './tokens'

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

@Global()
@Module({
  imports: [CoreModule],
  providers: [operatorAnswersProvider, mcpOauthBeginProvider],
  exports: [OPERATOR_ANSWERS, MCP_OAUTH_BEGIN],
})
export class HostCallsModule {}
