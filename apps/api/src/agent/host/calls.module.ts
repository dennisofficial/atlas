import { Global, Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'
import { eventTypesOf } from '@dltech/atlas-plugin-sdk'

import type { AgentHostEnv } from '../config/env'
import { operatorRequestRegistry } from '../config/operator-control'
import { McpOauthBeginService } from '../mcp-oauth/begin-service'
import { mcpOauthGatewayOf } from '../mcp-oauth/gateway'
import { OperatorAnswerService } from '../operator-input/answer-service'
import { registeredPlugins } from '../registered-plugins'
import type { SecretCipher } from '../config/secret-cipher'
import { createSessionStream, type SessionStream } from '../stream/session-stream'
import { STREAM_MAX_CONNECTIONS_PER_USER } from '../stream/stream-limits'
import { systemHostTimers } from '../stream/system-timers'
import { createUserSlots } from '../stream/user-slots'
import { CoreModule } from './core.module'
import {
  AGENT_HOST_ENV,
  CIPHER,
  DB,
  LOG,
  MCP_OAUTH_BEGIN,
  OPERATOR_ANSWERS,
  SESSION_STREAM,
} from './tokens'

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

const sessionStreamProvider: Provider = {
  provide: SESSION_STREAM,
  useFactory: (log: LogPort): SessionStream =>
    createSessionStream({
      users: createUserSlots({ limit: STREAM_MAX_CONNECTIONS_PER_USER }),
      timers: systemHostTimers,
      eventTypes: eventTypesOf(registeredPlugins),
      log,
    }),
  inject: [LOG],
}

@Global()
@Module({
  imports: [CoreModule],
  providers: [operatorAnswersProvider, mcpOauthBeginProvider, sessionStreamProvider],
  exports: [OPERATOR_ANSWERS, MCP_OAUTH_BEGIN, SESSION_STREAM],
})
export class HostCallsModule {}
