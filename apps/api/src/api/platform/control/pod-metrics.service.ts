import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
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

const sampleOf = (frame: EventFrame): PodSample | null => {
  const parsed = metricsSampleEventSchema.safeParse(frame.event)
  return parsed.success ? parsed.data.sample : null
}

const backlogOf = (outcome: PodCallOutcome): PodSample[] | null => {
  if (outcome.state === 'unavailable') return null
  const result = outcome.result
  if (result.status !== ECallStatus.Ok) return null
  if (result.op !== 'metrics.subscribe') return null
  return [...result.value.samples]
}

export type PodMetricsWatchArgs = {
  userId: string
  sessionId: string
  signal?: AbortSignal | undefined
}

@Injectable()
export class PodMetricsService {
  constructor(
    private readonly sessions: SessionsService,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
  ) {}

  async *watch(args: PodMetricsWatchArgs): AsyncGenerator<PodMetricsFrame> {
    await this.sessions.requireOwnedSession(args)
    const ops = this.ops
    if (ops === null) throw new ServiceUnavailableException(HOST_ABSENT)
    const queue = new PodMetricsQueue()
    const registered = ops.events({
      sessionId: args.sessionId,
      listener: (frame) => {
        const sample = sampleOf(frame)
        if (sample !== null) queue.push(sample)
      },
      onClose: () => queue.end(),
    })
    if (registered === null) return
    let subscribed = false
    let ended = false
    const stop = (): void => {
      if (ended) return
      ended = true
      args.signal?.removeEventListener('abort', stop)
      queue.end()
      registered()
      if (subscribed) void this.release({ ops, sessionId: args.sessionId })
    }
    args.signal?.addEventListener('abort', stop, { once: true })
    try {
      const outcome = await ops.invoke({
        sessionId: args.sessionId,
        op: { op: 'metrics.subscribe' },
      })
      if (ended) return
      const backlog = backlogOf(outcome)
      if (backlog === null) return
      subscribed = true
      let newest = backlog.at(-1)?.at ?? 0
      if (backlog.length > 0) yield { type: 'samples', samples: backlog }
      for (;;) {
        const sample = await queue.next()
        if (sample === undefined) return
        if (sample.at <= newest) continue
        newest = sample.at
        yield { type: 'sample', sample }
      }
    } finally {
      stop()
    }
  }

  private async release(args: { ops: PodOps; sessionId: string }): Promise<void> {
    await args.ops
      .invoke({ sessionId: args.sessionId, op: { op: 'metrics.unsubscribe' } })
      .catch(() => undefined)
  }
}
