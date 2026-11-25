import { randomUUID } from 'node:crypto'

import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common'
import type { PodMetricsFrame } from '@dltech/atlas-protocol'
import { POD_METRICS_BUS, type PodMetricsBus } from '../../../agent'
import { PodMetricsQueue } from './pod-metrics-queue'
import { SessionsService } from './sessions.service'

const BUS_ABSENT = 'pod metrics are not running in this process'

export const POD_METRICS_WATCH_TTL_MS = 15_000

export const POD_METRICS_RENEW_EVERY_MS = POD_METRICS_WATCH_TTL_MS / 3

export type PodMetricsWatchArgs = {
  userId: string
  sessionId: string
  signal?: AbortSignal | undefined
}

type WatchState = {
  ended: boolean
  announced: boolean
  newest: number
}

const freshFrames = (args: { frame: PodMetricsFrame; state: WatchState }): PodMetricsFrame[] => {
  const { frame, state } = args
  if (frame.type === 'unavailable') return [frame]
  if (frame.type === 'samples') {
    const samples = frame.samples.filter((sample) => sample.at > state.newest)
    if (samples.length === 0) return []
    state.newest = samples.at(-1)?.at ?? state.newest
    if (!state.announced) {
      state.announced = true
      return [{ type: 'samples', samples }]
    }
    return samples.map((sample) => ({ type: 'sample', sample }))
  }
  if (frame.sample.at <= state.newest) return []
  state.announced = true
  state.newest = frame.sample.at
  return [frame]
}

@Injectable()
export class PodMetricsService {
  private readonly logger = new Logger(PodMetricsService.name)

  constructor(
    private readonly sessions: SessionsService,
    @Optional() @Inject(POD_METRICS_BUS) private readonly bus: PodMetricsBus | null = null,
    @Optional() private readonly renewEveryMs: number = POD_METRICS_RENEW_EVERY_MS,
  ) {}

  async *watch(args: PodMetricsWatchArgs): AsyncGenerator<PodMetricsFrame> {
    await this.sessions.requireOwnedSession(args)
    const bus = this.bus
    if (bus === null) throw new ServiceUnavailableException(BUS_ABSENT)
    const queue = new PodMetricsQueue()
    const state: WatchState = { ended: false, announced: false, newest: 0 }
    let timer: ReturnType<typeof setInterval> | undefined
    let unsubscribe: () => Promise<void> = async () => undefined
    const stop = (): void => {
      if (state.ended) return
      state.ended = true
      args.signal?.removeEventListener('abort', stop)
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      queue.end()
    }
    args.signal?.addEventListener('abort', stop, { once: true })
    const watcherId = randomUUID()
    const renew = (): void => {
      if (state.ended) return
      void bus.requestWatch({
        sessionId: args.sessionId,
        watcherId,
        ttlMs: POD_METRICS_WATCH_TTL_MS,
      })
    }
    try {
      unsubscribe = await bus.subscribe({
        sessionId: args.sessionId,
        listener: (frame) => {
          queue.push(frame)
          if (frame.type === 'unavailable') queue.end()
        },
      })
      if (state.ended) return
      renew()
      timer = setInterval(renew, this.renewEveryMs)
      timer.unref()
      for (;;) {
        const frame = await queue.next()
        if (frame === undefined) return
        for (const next of freshFrames({ frame, state })) yield next
        if (frame.type === 'unavailable') {
          this.logger.warn({ sessionId: args.sessionId, reason: frame.reason })
          return
        }
      }
    } finally {
      stop()
      await unsubscribe()
    }
  }
}
