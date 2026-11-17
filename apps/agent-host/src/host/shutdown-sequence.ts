import type { BeforeApplicationShutdown, OnApplicationShutdown } from '@nestjs/common'
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
  stream: Pick<StreamService, 'drain' | 'stop'>
  holder: { drain(): Promise<void> }
  follow: Pick<FollowStack, 'close'>
  pool: { end(): Promise<void> }
}

const HANDOFF_HARD_EXIT_MS = 5_000

export class HostShutdownSequence implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly args: HostShutdownSequenceArgs

  constructor(args: HostShutdownSequenceArgs) {
    this.args = args
  }

  async beforeApplicationShutdown(): Promise<void> {
    let clear = (): void => undefined
    const deadline = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, HANDOFF_HARD_EXIT_MS)
      clear = () => clearTimeout(timer)
    })
    await Promise.race([
      Promise.all([this.args.stream.drain({}), this.args.holder.drain()]),
      deadline,
    ]).finally(clear)
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
