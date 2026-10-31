import {
  projectSchema,
  threadStreamFrameSchema,
  wireThreadSchema,
  type Project,
  type ThreadStreamFrame,
} from '@dltech/atlas-wire'
import { Logger, type Provider } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { z } from 'zod'
import type { ThreadDto } from './sessions.types'
import { RedisService } from '../../../_lib/redis/redis.service'

export const THREAD_SIGNAL_CHANNEL = 'atlas:thread-signals'

export type ThreadFrameSignal = { threadId: string; frame: ThreadStreamFrame }
export type ThreadChangedSignal = {
  userId: string
  threadId: string
  rev: number
  thread: ThreadDto
  session: ThreadChangedSession
}
export type ThreadChangedSession = {
  id: string
  projectId: string | null
  managedBySessionId: string | null
  mainThreadId: string | null
  updatedAt: string
}
export type ProjectChangedSignal = { userId: string; project: Project }
export type ProjectRemovedSignal = { userId: string; projectId: string; removed: true }
export type ThreadSignal =
  | ThreadFrameSignal
  | ThreadChangedSignal
  | ProjectChangedSignal
  | ProjectRemovedSignal

const threadFrameSignalSchema = z.strictObject({
  threadId: z.string().min(1),
  frame: threadStreamFrameSchema,
})
const threadChangedSessionSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().nullable(),
  managedBySessionId: z.string().nullable(),
  mainThreadId: z.string().nullable(),
  updatedAt: z.string(),
})
const threadChangedSignalSchema = z.strictObject({
  userId: z.string().min(1),
  threadId: z.string().min(1),
  rev: z.number().int().nonnegative(),
  thread: wireThreadSchema.extend({ forkMode: z.string().optional() }),
  session: threadChangedSessionSchema,
})
const projectChangedSignalSchema = z.strictObject({
  userId: z.string().min(1),
  project: projectSchema,
})
const projectRemovedSignalSchema = z.strictObject({
  userId: z.string().min(1),
  projectId: z.string().min(1),
  removed: z.literal(true),
})
const threadSignalSchema = z.union([
  threadFrameSignalSchema,
  threadChangedSignalSchema,
  projectChangedSignalSchema,
  projectRemovedSignalSchema,
])

export const isThreadChangedSignal = (signal: ThreadSignal): signal is ThreadChangedSignal =>
  'thread' in signal

export const isProjectChangedSignal = (signal: ThreadSignal): signal is ProjectChangedSignal =>
  'project' in signal

export const isProjectRemovedSignal = (signal: ThreadSignal): signal is ProjectRemovedSignal =>
  'removed' in signal

export function parseThreadSignal(args: { raw: string }): ThreadSignal | undefined {
  try {
    const parsed = threadSignalSchema.safeParse(JSON.parse(args.raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export type ThreadSignalSubscription = {
  onMessage: (raw: string) => void
  onClosed?: () => void
}

export abstract class ThreadSignalBus {
  abstract readonly distributed: boolean
  abstract publish(args: ThreadSignal): Promise<void>
  abstract subscribe(args: ThreadSignalSubscription): void | Promise<void>
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

  subscribe(args: ThreadSignalSubscription): Promise<void> {
    const subscriber = this.redis.duplicate()
    this.subscriber = subscriber
    let interrupted = false
    const handleClosed = (): void => {
      if (interrupted || this.subscriber !== subscriber) return
      interrupted = true
      args.onClosed?.()
    }
    subscriber.on('message', (_channel: string, raw: string) => {
      if (!interrupted && this.subscriber === subscriber) args.onMessage(raw)
    })
    subscriber.on('error', (failure: Error) => {
      this.logger.warn(`the thread signal subscriber errored: ${failure.message}`)
      handleClosed()
    })
    for (const event of ['close', 'reconnecting', 'end']) subscriber.on(event, handleClosed)
    const ready = subscriber.subscribe(THREAD_SIGNAL_CHANNEL).then(() => {})
    void ready.catch((failure: unknown) => {
      this.logger.warn(`subscribing to ${THREAD_SIGNAL_CHANNEL} failed: ${String(failure)}`)
      handleClosed()
    })
    return ready
  }

  async close(): Promise<void> {
    const subscriber = this.subscriber
    this.subscriber = undefined
    if (subscriber === undefined) return
    if (subscriber.status !== 'ready') {
      subscriber.disconnect()
      return
    }
    await subscriber.quit().catch(() => subscriber.disconnect())
  }
}

export const threadSignalBusProvider: Provider = {
  provide: ThreadSignalBus,
  inject: [RedisService],
  useFactory: (redis: RedisService): ThreadSignalBus =>
    redis.isConfigured() ? new RedisThreadSignalBus(redis) : new InProcessThreadSignalBus(),
}
