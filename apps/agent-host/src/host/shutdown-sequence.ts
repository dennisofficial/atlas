import type { OnApplicationShutdown } from '@nestjs/common'
import type { HostPresence } from '@dltech/atlas-host'

import type { PgWakeListener } from '../bus/pg-wake-listener'
import type { RedisLiveFrames } from '../bus/redis-live-frames'
import type { FollowStack } from './follow-stack'
import type { HostWatchService } from './host-watch-service'
import type { StreamService } from './stream-service'

export type HostShutdownSequenceArgs = {
  watch: Pick<HostWatchService, 'close'>
  presence: Pick<HostPresence, 'close'>
  wakes: Pick<PgWakeListener, 'close'>
  liveFrames: Pick<RedisLiveFrames, 'close'>
  stream: Pick<StreamService, 'stop'>
  follow: Pick<FollowStack, 'close'>
  pool: { end(): Promise<void> }
}

export class HostShutdownSequence implements OnApplicationShutdown {
  private readonly args: HostShutdownSequenceArgs

  constructor(args: HostShutdownSequenceArgs) {
    this.args = args
  }

  async onApplicationShutdown(): Promise<void> {
    await this.args.watch.close()
    await this.args.presence.close()
    await this.args.wakes.close()
    await this.args.liveFrames.close()
    await this.args.stream.stop()
    await this.args.follow.close()
    await this.args.pool.end()
  }
}
