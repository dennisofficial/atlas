import { Module, type Provider } from '@nestjs/common'
import type { Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { StreamService } from './stream-service'
import { AGENT_HOST_ENV, LOG, POOL, STREAM } from './tokens'

const streamProvider: Provider = {
  provide: STREAM,
  useFactory: (env: AgentHostEnv, pool: Pool, log: LogPort): StreamService =>
    new StreamService({ env, pool, log }),
  inject: [AGENT_HOST_ENV, POOL, LOG],
}

@Module({
  providers: [streamProvider],
  exports: [STREAM],
})
export class StreamModule {}
