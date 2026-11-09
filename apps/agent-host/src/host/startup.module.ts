import { Module, type Provider } from '@nestjs/common'
import type { Pool } from '@dltech/atlas-db'
import type { HostPresence, SessionHolder } from '@dltech/atlas-host'

import type { PgWakeListener } from '../bus/pg-wake-listener'
import type { RedisLiveFrames } from '../bus/redis-live-frames'
import { ControlModule } from './control.module'
import type { FollowStack } from './follow-stack'
import { HolderModule } from './holder.module'
import type { HostWatchService } from './host-watch-service'
import { RuntimeModule } from './runtime.module'
import { HostShutdownSequence } from './shutdown-sequence'
import { HostStartupService } from './startup.service'
import { StreamModule } from './stream.module'
import type { StreamService } from './stream-service'
import {
  FOLLOW_STACK,
  HOLDER,
  HOST_WATCH,
  LIVE_FRAMES,
  POOL,
  PRESENCE,
  SHUTDOWN,
  STARTUP,
  STREAM,
  WAKE_LISTENER,
} from './tokens'

const startupProvider: Provider = {
  provide: STARTUP,
  useFactory: (
    holder: SessionHolder,
    watch: HostWatchService,
    follow: FollowStack,
    stream: StreamService,
  ): HostStartupService => new HostStartupService({ holder, watch, follow, stream }),
  inject: [HOLDER, HOST_WATCH, FOLLOW_STACK, STREAM],
}

const shutdownProvider: Provider = {
  provide: SHUTDOWN,
  useFactory: (
    watch: HostWatchService,
    presence: HostPresence,
    wakes: PgWakeListener,
    liveFrames: RedisLiveFrames,
    stream: StreamService,
    follow: FollowStack,
    pool: Pool,
  ): HostShutdownSequence =>
    new HostShutdownSequence({ watch, presence, wakes, liveFrames, stream, follow, pool }),
  inject: [HOST_WATCH, PRESENCE, WAKE_LISTENER, LIVE_FRAMES, STREAM, FOLLOW_STACK, POOL],
}

@Module({
  imports: [ControlModule, RuntimeModule, HolderModule, StreamModule],
  providers: [startupProvider, shutdownProvider],
})
export class StartupModule {}
