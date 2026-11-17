import { Global, Module, type Provider } from '@nestjs/common'
import type { Db } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { operatorRequestRegistry } from '../config/operator-control'
import { McpOauthBeginService } from '../mcp-oauth/begin-service'
import { mcpOauthGatewayOf } from '../mcp-oauth/gateway'
import { OperatorAnswerService } from '../operator-input/answer-service'
import type { SecretCipher } from '../config/secret-cipher'
import { createSessionStream, type SessionStream } from '../stream/session-stream'
import type { StreamService } from '../stream/stream-service'
import { systemHostTimers } from '../stream/system-timers'
import { CoreModule } from './core.module'
import { StreamModule } from './stream.module'
import {
  AGENT_HOST_ENV,
  CIPHER,
  DB,
  LOG,
  MCP_OAUTH_BEGIN,
  OPERATOR_ANSWERS,
  SESSION_STREAM,
  STREAM,
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
  useFactory: (stream: StreamService, log: LogPort): SessionStream => {
    const sessionStream = createSessionStream({
      subscriptions: () => stream.subscriptionsPort(),
      users: stream.slots(),
      timers: systemHostTimers,
      eventTypes: stream.eventTypes(),
      log,
    })
    stream.onDrain(() => sessionStream.drain())
    return sessionStream
  },
  inject: [STREAM, LOG],
}

@Global()
@Module({
  imports: [CoreModule, StreamModule],
  providers: [operatorAnswersProvider, mcpOauthBeginProvider, sessionStreamProvider],
  exports: [OPERATOR_ANSWERS, MCP_OAUTH_BEGIN, SESSION_STREAM],
})
export class HostCallsModule {}
