import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common'
import type { EventFrame, PodCallOutcome } from '@dltech/atlas-host'
import {
  ECallStatus,
  type PodMetricsFrame,
  type PodSample,
  metricsSampleEventSchema,
} from '@dltech/atlas-protocol'
import { POD_OPS, type PodOps } from '../../../agent'
import { PodMetricsQueue } from './pod-metrics-queue'
import { SessionsService } from './sessions.service'

const HOST_ABSENT = 'pod metrics are not running in this process'
const UNREADABLE = 'pod metrics are not readable'
const UNHELD_RECHECK_MS = 5_000

const sampleOf = (frame: EventFrame): PodSample | null => {
  const parsed = metricsSampleEventSchema.safeParse(frame.event)
  return parsed.success ? parsed.data.sample : null
}

type Backlog = { samples: PodSample[] } | { reason: string }

const backlogOf = (outcome: PodCallOutcome): Backlog => {
  if (outcome.state === 'unavailable') return { reason: UNREADABLE }
  const result = outcome.result
  if (result.status !== ECallStatus.Ok) return { reason: result.error.message }
  if (result.op !== 'metrics.subscribe') return { reason: UNREADABLE }
  return { samples: [...result.value.samples] }
}

export type PodMetricsWatchArgs = {
  userId: string
  sessionId: string
  signal?: AbortSignal | undefined
}

type WatchState = {
  ended: boolean
  dispose: (() => void) | null
  subscribed: boolean
  released: boolean
  newest: number
}

type StartOutcome =
  | { state: 'samples'; samples: PodSample[] }
  | { state: 'unavailable'; reason: string }
  | { state: 'unheld' }
  | { state: 'stopped' }

@Injectable()
export class PodMetricsService {
  private readonly logger = new Logger(PodMetricsService.name)

  constructor(
    private readonly sessions: SessionsService,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
    @Optional() private readonly unheldRecheckMs: number = UNHELD_RECHECK_MS,
  ) {}

  async *watch(args: PodMetricsWatchArgs): AsyncGenerator<PodMetricsFrame> {
    await this.sessions.requireOwnedSession(args)
    const ops = this.ops
    if (ops === null) throw new ServiceUnavailableException(HOST_ABSENT)
    const queue = new PodMetricsQueue()
    const state: WatchState = {
      ended: false,
      dispose: null,
      subscribed: false,
      released: false,
      newest: 0,
    }
    const stop = (): void => {
      if (state.ended) return
      state.ended = true
      args.signal?.removeEventListener('abort', stop)
      const dispose = state.dispose
      state.dispose = null
      dispose?.()
      queue.end()
    }
    args.signal?.addEventListener('abort', stop, { once: true })
    try {
      while (!state.ended) {
        const started = await this.start({
          ops,
          sessionId: args.sessionId,
          queue,
          state,
        })
        if (started.state === 'stopped') return
        if (started.state === 'unavailable') {
          if (state.ended) return
          this.logger.warn({ sessionId: args.sessionId, reason: started.reason })
          yield { type: 'unavailable', reason: started.reason }
          return
        }
        if (started.state === 'unheld') {
          await this.recheck({
            state,
            ...(args.signal === undefined ? {} : { signal: args.signal }),
          })
          continue
        }
        if (state.ended) return
        if (started.samples.length > 0) {
          state.newest = Math.max(state.newest, started.samples.at(-1)?.at ?? 0)
          yield { type: 'samples', samples: started.samples }
        }
        for (;;) {
          const sample = await queue.next()
          if (sample === undefined) return
          if (sample.at <= state.newest) continue
          state.newest = sample.at
          yield { type: 'sample', sample }
        }
      }
    } finally {
      stop()
      if (state.subscribed && !state.released) {
        state.released = true
        void this.release({ ops, sessionId: args.sessionId })
      }
    }
  }

  private async start(args: {
    ops: PodOps
    sessionId: string
    queue: PodMetricsQueue
    state: WatchState
  }): Promise<StartOutcome> {
    const registered = args.ops.events({
      sessionId: args.sessionId,
      listener: (frame) => {
        const sample = sampleOf(frame)
        if (sample !== null) args.queue.push(sample)
      },
      onClose: () => args.queue.end(),
    })
    if (registered === null) return { state: 'unheld' }
    args.state.dispose = registered
    if (args.state.ended) return { state: 'stopped' }
    const outcome = await args.ops.invoke({
      sessionId: args.sessionId,
      op: { op: 'metrics.subscribe' },
    })
    const backlog = backlogOf(outcome)
    if ('reason' in backlog) return { state: 'unavailable', reason: backlog.reason }
    args.state.subscribed = true
    return { state: 'samples', samples: backlog.samples }
  }

  private recheck(args: { state: WatchState; signal?: AbortSignal | undefined }): Promise<void> {
    if (args.state.ended) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        args.signal?.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, this.unheldRecheckMs)
      timer.unref()
      args.signal?.addEventListener('abort', finish, { once: true })
    })
  }

  private async release(args: { ops: PodOps; sessionId: string }): Promise<void> {
    await args.ops
      .invoke({ sessionId: args.sessionId, op: { op: 'metrics.unsubscribe' } })
      .catch(() => undefined)
  }
}
