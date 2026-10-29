import { threadStreamFrameSchema, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { Logger, type Provider } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { z } from 'zod'
import { RedisService } from '../../../_lib/redis/redis.service'

export const THREAD_SIGNAL_CHANNEL = 'atlas:thread-signals'

export type ThreadFrameSignal = { threadId: string; frame: ThreadStreamFrame }
export type ListSignal = { userId: string; threadId: string }
export type ThreadSignal = ThreadFrameSignal | ListSignal

const threadFrameSignalSchema = z.strictObject({
  threadId: z.string().min(1),
  frame: threadStreamFrameSchema,
})
const listSignalSchema = z.strictObject({ userId: z.string().min(1), threadId: z.string().min(1) })
const threadSignalSchema = z.union([threadFrameSignalSchema, listSignalSchema])

export const isListSignal = (signal: ThreadSignal): signal is ListSignal => !('frame' in signal)

export function parseThreadSignal(args: { raw: string }): ThreadSignal | undefined {
  try {
    const parsed = threadSignalSchema.safeParse(JSON.parse(args.raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export abstract class ThreadSignalBus {
  abstract readonly distributed: boolean
  abstract publish(args: ThreadSignal): Promise<void>
  abstract subscribe(args: { onMessage: (raw: string) => void }): void
  abstract close(): Promise<void>
}

export class InProcessThreadSignalBus extends ThreadSignalBus {
  readonly distributed = false
  private handlers: Array<(raw: string) => void> = []

  async publish(args: ThreadSignal): Promise<void> {
    const raw = JSON.stringify(args)
    for (const onMessage of this.handlers) onMessage(raw)
  }

  subscribe(args: { onMessage: (raw: string) => void }): void {
    this.handlers.push(args.onMessage)
  }

  async close(): Promise<void> {
    this.handlers = []
  }
}

export class RedisThreadSignalBus extends ThreadSignalBus {
  readonly distributed = true
  private readonly logger = new Logger(RedisThreadSignalBus.name)
  private subscriber: Redis | undefined

  constructor(private readonly redis: RedisService) {
    super()
  }

  async publish(args: ThreadSignal): Promise<void> {
    await this.redis.client().publish(THREAD_SIGNAL_CHANNEL, JSON.stringify(args))
  }

  subscribe(args: { onMessage: (raw: string) => void }): void {
    const subscriber = this.redis.duplicate()
    this.subscriber = subscriber
    subscriber.on('message', (_channel: string, raw: string) => args.onMessage(raw))
    subscriber.on('error', (failure: Error) => {
      this.logger.warn(`the thread signal subscriber errored: ${failure.message}`)
    })
    subscriber.subscribe(THREAD_SIGNAL_CHANNEL).catch((failure: unknown) => {
      this.logger.warn(`subscribing to ${THREAD_SIGNAL_CHANNEL} failed: ${String(failure)}`)
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

export const threadSignalBusProvider: Provider = {
  provide: ThreadSignalBus,
  inject: [RedisService],
  useFactory: (redis: RedisService): ThreadSignalBus =>
    redis.isConfigured() ? new RedisThreadSignalBus(redis) : new InProcessThreadSignalBus(),
}
