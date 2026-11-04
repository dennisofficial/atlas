import type { HostBus } from '@dltech/atlas-host'

import type { PgWakeListener } from './pg-wake-listener'
import type { RedisLiveFrames } from './redis-live-frames'

export const createHostBus = (args: {
  wakes: PgWakeListener
  liveFrames: RedisLiveFrames
}): HostBus => ({
  onWake: (listener) => args.wakes.onWake(listener),
  onResync: (listener) => args.wakes.onResync(listener),
  live: (liveArgs) => args.liveFrames.live(liveArgs),
})
