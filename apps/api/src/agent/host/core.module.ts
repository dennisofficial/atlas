import { Global, Module, type DynamicModule } from '@nestjs/common'
import { createDb, createPool, type Db, type Pool } from '@dltech/atlas-db'
import type { ErrorReporter, LogPort } from '@dltech/atlas-observability'

import { ERROR_REPORTER } from '../analytics/tokens'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { JsonLog } from './json-log'
import { AGENT_HOST_ENV, CIPHER, DB, LOG, POOL } from './tokens'
import { handleTransactionTimeout } from './transaction-timeout'

const QUERY_TIMEOUT_MS = 10_000
const AGENT_HOST_POOL_MIN_IDLE = 2

@Global()
@Module({})
export class CoreModule {
  static forRoot(env: AgentHostEnv): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: AGENT_HOST_ENV, useValue: env },
        { provide: LOG, useFactory: (): LogPort => new JsonLog() },
        {
          provide: POOL,
          useFactory: (agentHostEnv: AgentHostEnv, log: LogPort, errors: ErrorReporter): Pool =>
            createPool(databaseUrlWithTls(agentHostEnv.databaseUrl), {
              queryTimeoutMs: QUERY_TIMEOUT_MS,
              minIdle: AGENT_HOST_POOL_MIN_IDLE,
              onTransactionTimeout: (report) => handleTransactionTimeout({ report, log, errors }),
            }),
          inject: [AGENT_HOST_ENV, LOG, ERROR_REPORTER],
        },
        { provide: DB, useFactory: (pool: Pool): Db => createDb(pool), inject: [POOL] },
        {
          provide: CIPHER,
          useFactory: (agentHostEnv: AgentHostEnv): SecretCipher =>
            new SecretCipher(agentHostEnv.secretsEncryptionKey),
          inject: [AGENT_HOST_ENV],
        },
      ],
      exports: [AGENT_HOST_ENV, LOG, POOL, DB, CIPHER],
    }
  }
}
