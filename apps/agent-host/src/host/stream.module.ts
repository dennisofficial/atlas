import { Module, type Provider } from '@nestjs/common'
import type { Pool } from '@dltech/atlas-db'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { registeredPlugins } from '../registered-plugins'
import { eventTypesOf } from '@dltech/atlas-plugin-sdk'
import { createPgStreamAuth } from '../stream/pg-stream-auth'
import { StreamGateway } from '../stream/stream.gateway'
import { StreamService } from '../stream/stream-service'
import { systemHostTimers } from '../stream/system-timers'
import { AGENT_HOST_ENV, LOG, POOL, STREAM } from './tokens'

const streamProvider: Provider = {
  provide: STREAM,
  useFactory: (env: AgentHostEnv, pool: Pool, log: LogPort): StreamService =>
    new StreamService({
      auth: createPgStreamAuth({ pool }),
      trustedOrigins: env.trustedOrigins,
      timers: systemHostTimers,
      eventTypes: eventTypesOf(registeredPlugins),
      log,
    }),
  inject: [AGENT_HOST_ENV, POOL, LOG],
}

@Module({
  providers: [streamProvider, StreamGateway],
  exports: [STREAM],
})
export class StreamModule {}
