import type { BeforeApplicationShutdown, OnApplicationShutdown } from '@nestjs/common'
import type { HostPresence } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { PgWakeListener } from '../bus/pg-wake-listener'
import type { RedisLiveFrames } from '../bus/redis-live-frames'
import type { SessionStream } from '../stream/session-stream'
import type { FollowStack } from './follow-stack'
import type { HostWatchService } from './host-watch-service'

export type HostShutdownSequenceArgs = {
  watch: Pick<HostWatchService, 'close'>
  presence: Pick<HostPresence, 'close'>
  wakes: Pick<PgWakeListener, 'close'>
  liveFrames: Pick<RedisLiveFrames, 'close'>
  stream: Pick<SessionStream, 'drain' | 'stop'>
  holder: { drain(): Promise<void> }
  follow: Pick<FollowStack, 'close'>
  pool: { end(): Promise<void> }
  log: Pick<LogPort, 'info' | 'warn'>
  exit?: (code: number) => void
  hardExitAfterMs?: number
}

export const HANDOFF_HARD_EXIT_MS = 5_000

const processExit = (code: number): void => process.exit(code)

export class HostShutdownSequence implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly args: HostShutdownSequenceArgs

  constructor(args: HostShutdownSequenceArgs) {
    this.args = args
  }

  async beforeApplicationShutdown(): Promise<void> {
    const cap = this.args.hardExitAfterMs ?? HANDOFF_HARD_EXIT_MS
    this.args.log.info({ source: 'main', message: 'draining' })
    if (await this.withinCap(cap)) return
    this.args.log.warn({
      source: 'main',
      message: `hard exit: the drain did not finish in ${cap}ms`,
    })
    ;(this.args.exit ?? processExit)(1)
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

  private withinCap(ms: number): Promise<boolean> {
    let clear = (): void => undefined
    const deadline = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      clear = () => clearTimeout(timer)
    })
    const drained = Promise.all([this.args.stream.drain(), this.args.holder.drain()]).then(
      () => true,
    )
    return Promise.race([drained, deadline]).finally(clear)
  }
}
