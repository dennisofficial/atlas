import type { BeforeApplicationShutdown, OnApplicationShutdown } from '@nestjs/common'
import type { HostPresence } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

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
  handoffBudgetMs?: number
}

export const LEASE_HANDOFF_MS = 1_000

export class HostShutdownSequence implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly args: HostShutdownSequenceArgs

  constructor(args: HostShutdownSequenceArgs) {
    this.args = args
  }

  async beforeApplicationShutdown(): Promise<void> {
    const budget = this.args.handoffBudgetMs ?? LEASE_HANDOFF_MS
    this.args.log.info({ source: 'main', message: 'draining' })
    this.args.stream.drain()
    if (await this.handBackWithin(budget)) return
    this.args.log.warn({
      source: 'main',
      message: `the lease hand-off outlived ${budget}ms; the leases expire on their TTL`,
    })
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

  private handBackWithin(ms: number): Promise<boolean> {
    let clear = (): void => undefined
    const expired = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      clear = () => clearTimeout(timer)
    })
    const handedBack = this.args.holder.drain().then(
      () => true,
      (error: unknown) => {
        this.args.log.warn({
          source: 'main',
          message: 'the lease hand-off failed; the leases expire on their TTL',
          ...logFieldsOf({ error }),
        })
        return true
      },
    )
    return Promise.race([handedBack, expired]).finally(clear)
  }
}
