import { Logger, type Provider } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { RedisService } from '../../../_lib/redis/redis.service'
import { PR_FRAME_CHANNEL, type PrFrame } from './github-pr-fanout.frame'

export abstract class PrFrameBus {
  abstract readonly distributed: boolean
  abstract publish(args: { frame: PrFrame }): Promise<void>
  abstract subscribe(args: { onMessage: (raw: string) => void }): void
  abstract close(): Promise<void>
}

export class LocalPrFrameBus extends PrFrameBus {
  readonly distributed = false

  async publish(): Promise<void> {}

  subscribe(): void {}

  async close(): Promise<void> {}
}

export class RedisPrFrameBus extends PrFrameBus {
  readonly distributed = true
  private readonly logger = new Logger(RedisPrFrameBus.name)
  private subscriber: Redis | undefined

  constructor(private readonly redis: RedisService) {
    super()
  }

  async publish(args: { frame: PrFrame }): Promise<void> {
    await this.redis.client().publish(PR_FRAME_CHANNEL, JSON.stringify(args.frame))
  }

  subscribe(args: { onMessage: (raw: string) => void }): void {
    const subscriber = this.redis.duplicate()
    this.subscriber = subscriber
    subscriber.on('message', (_channel: string, raw: string) => args.onMessage(raw))
    subscriber.on('error', (failure: Error) => {
      this.logger.warn(`the pr frame subscriber errored: ${failure.message}`)
    })
    subscriber.subscribe(PR_FRAME_CHANNEL).catch((failure: unknown) => {
      this.logger.warn(`subscribing to ${PR_FRAME_CHANNEL} failed: ${String(failure)}`)
    })
  }

  async close(): Promise<void> {
    const subscriber = this.subscriber
    this.subscriber = undefined
    // ioredis: quit() on a lazyConnect client still in 'wait' never resolves.
    if (subscriber === undefined || subscriber.status === 'wait') return
    await subscriber.quit().catch(() => subscriber.disconnect())
  }
}

export const prFrameBusProvider: Provider = {
  provide: PrFrameBus,
  inject: [RedisService],
  useFactory: (redis: RedisService): PrFrameBus =>
    redis.isConfigured() ? new RedisPrFrameBus(redis) : new LocalPrFrameBus(),
}
