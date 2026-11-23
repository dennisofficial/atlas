import { Module, type Provider } from '@nestjs/common'
import type { Pool } from '@dltech/atlas-db'
import type { HostPresence, PodCallBus, SessionHolder } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { PodMetricsBus } from '../bus/pod-metrics-bus'
import type { PgWakeListener } from '../bus/pg-wake-listener'
import type { RedisLiveFrames } from '../bus/redis-live-frames'
import { ControlModule } from './control.module'
import type { FollowStack } from './follow-stack'
import { HolderModule } from './holder.module'
import type { HostWatchService } from './host-watch-service'
import { RuntimeModule } from './runtime.module'
import { HostShutdownSequence } from './shutdown-sequence'
import { HostStartupService } from './startup.service'
import type { SessionStream } from '../stream/session-stream'
import {
  FOLLOW_STACK,
  HOLDER,
  HOST_WATCH,
  LIVE_FRAMES,
  LOG,
  POD_CALL_BUS,
  POD_METRICS_BUS,
  POOL,
  PRESENCE,
  SESSION_STREAM,
  SHUTDOWN,
  STARTUP,
  WAKE_LISTENER,
} from './tokens'

const startupProvider: Provider = {
  provide: STARTUP,
  useFactory: (
    holder: SessionHolder,
    watch: HostWatchService,
    follow: FollowStack,
    stream: SessionStream,
  ): HostStartupService => new HostStartupService({ holder, watch, follow, stream }),
  inject: [HOLDER, HOST_WATCH, FOLLOW_STACK, SESSION_STREAM],
}

const shutdownProvider: Provider = {
  provide: SHUTDOWN,
  useFactory: (
    watch: HostWatchService,
    presence: HostPresence,
    wakes: PgWakeListener,
    liveFrames: RedisLiveFrames,
    podMetrics: PodMetricsBus,
    podCalls: PodCallBus,
    stream: SessionStream,
    follow: FollowStack,
    pool: Pool,
    holder: SessionHolder,
    log: LogPort,
  ): HostShutdownSequence =>
    new HostShutdownSequence({
      watch,
      presence,
      wakes,
      liveFrames,
      podMetrics,
      podCalls,
      stream,
      follow,
      pool,
      holder,
      log,
    }),
  inject: [
    HOST_WATCH,
    PRESENCE,
    WAKE_LISTENER,
    LIVE_FRAMES,
    POD_METRICS_BUS,
    POD_CALL_BUS,
    SESSION_STREAM,
    FOLLOW_STACK,
    POOL,
    HOLDER,
    LOG,
  ],
}

@Module({
  imports: [ControlModule, RuntimeModule, HolderModule],
  providers: [startupProvider, shutdownProvider],
})
export class StartupModule {}
