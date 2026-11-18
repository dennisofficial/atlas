import { Global, Module, type DynamicModule } from '@nestjs/common'
import { createDb, createPool, type Db, type Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import { SecretCipher } from '../config/secret-cipher'
import { JsonLog } from './json-log'
import { AGENT_HOST_ENV, CIPHER, DB, LOG, POOL } from './tokens'

const QUERY_TIMEOUT_MS = 10_000

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
          useFactory: (agentHostEnv: AgentHostEnv): Pool =>
            createPool(databaseUrlWithTls(agentHostEnv.databaseUrl), {
              queryTimeoutMs: QUERY_TIMEOUT_MS,
            }),
          inject: [AGENT_HOST_ENV],
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
