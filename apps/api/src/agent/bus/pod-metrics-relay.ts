import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { EventFrame, PodCallOutcome } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  ECallStatus,
  METRICS_RING_SIZE,
  metricsSampleEventSchema,
  type PodMetricsFrame,
  type PodMetricsWatch,
  type PodSample,
} from '@dltech/atlas-protocol'

import type { PodOps } from '../host/pod-ops'
import type { PodMetricsBus } from './pod-metrics-bus'

const UNREADABLE = 'pod metrics are not readable'

type Backlog = { samples: PodSample[] } | { reason: string }

const backlogOf = (outcome: PodCallOutcome): Backlog => {
  if (outcome.state === 'unavailable') return { reason: UNREADABLE }
  const result = outcome.result
  if (result.status !== ECallStatus.Ok) return { reason: result.error.message }
  if (result.op !== 'metrics.subscribe') return { reason: UNREADABLE }
  return { samples: [...result.value.samples] }
}

const merged = (args: { backlog: PodSample[]; live: PodSample[] }): PodSample[] => {
  const byAt = new Map<number, PodSample>()
  for (const sample of args.backlog) byAt.set(sample.at, sample)
  for (const sample of args.live) byAt.set(sample.at, sample)
  return [...byAt.values()].sort((left, right) => left.at - right.at).slice(-METRICS_RING_SIZE)
}

type RelayState = {
  sessionId: string
  watchers: Set<string>
  ring: PodSample[]
  dispose: () => void
  timer: ReturnType<typeof setTimeout> | undefined
  ready: boolean
}

const ringOf = (relay: RelayState): PodSample[] => [...relay.ring]

export type PodMetricsRelayArgs = {
  ops: Pick<PodOps, 'events' | 'invoke'>
  bus: Pick<PodMetricsBus, 'onWatch' | 'publish'>
  log?: LogPort | undefined
}

export class PodMetricsRelay implements OnModuleInit, OnModuleDestroy {
  private readonly args: PodMetricsRelayArgs
  private readonly relays = new Map<string, RelayState>()
  private watching: (() => void) | undefined

  constructor(args: PodMetricsRelayArgs) {
    this.args = args
  }

  onModuleInit(): void {
    this.watching = this.args.bus.onWatch((request) => this.receive(request))
  }

  async onModuleDestroy(): Promise<void> {
    this.watching?.()
    this.watching = undefined
    const relays = [...this.relays.values()]
    for (const relay of relays) this.stop({ relay, release: false })
    await Promise.all(relays.map((relay) => this.release(relay.sessionId)))
  }

  private receive(request: PodMetricsWatch): void {
    const held = this.relays.get(request.sessionId)
    if (held !== undefined) {
      this.renew({ relay: held, request })
      return
    }
    const relay: RelayState = {
      sessionId: request.sessionId,
      watchers: new Set([request.watcherId]),
      ring: [],
      dispose: () => undefined,
      timer: undefined,
      ready: false,
    }
    const dispose = this.args.ops.events({
      sessionId: request.sessionId,
      listener: (frame) => this.receiveSample({ relay, frame }),
      onClose: () => this.stop({ relay, release: false }),
    })
    if (dispose === null) return
    relay.dispose = dispose
    this.relays.set(relay.sessionId, relay)
    this.renew({ relay, request })
    void this.seed(relay)
  }

  private renew(args: { relay: RelayState; request: PodMetricsWatch }): void {
    const { relay, request } = args
    const added = !relay.watchers.has(request.watcherId)
    relay.watchers.add(request.watcherId)
    clearTimeout(relay.timer)
    relay.timer = setTimeout(() => this.stop({ relay, release: true }), request.ttlMs)
    relay.timer.unref()
    if (added && relay.ready) {
      void this.publish({
        sessionId: relay.sessionId,
        frame: { type: 'samples', samples: ringOf(relay) },
      })
    }
  }

  private async seed(relay: RelayState): Promise<void> {
    const outcome = await this.args.ops
      .invoke({ sessionId: relay.sessionId, op: { op: 'metrics.subscribe' } })
      .catch((error: unknown) => {
        this.args.log?.warn({
          source: 'bus.pod-metrics',
          message: `subscribing to pod metrics for ${relay.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
        return null
      })
    if (outcome === null) {
      this.stop({ relay, release: true })
      return
    }
    const backlog = backlogOf(outcome)
    if ('reason' in backlog) {
      this.args.log?.warn({
        source: 'bus.pod-metrics',
        message: `relaying pod metrics for ${relay.sessionId} failed`,
        data: { reason: backlog.reason },
      })
      this.stop({ relay, release: false })
      await this.publish({
        sessionId: relay.sessionId,
        frame: { type: 'unavailable', reason: backlog.reason },
      })
      return
    }
    if (this.relays.get(relay.sessionId) !== relay) return
    relay.ready = true
    relay.ring = merged({ backlog: backlog.samples, live: relay.ring })
    await this.publish({
      sessionId: relay.sessionId,
      frame: { type: 'samples', samples: ringOf(relay) },
    })
  }

  private receiveSample(args: { relay: RelayState; frame: EventFrame }): void {
    const { relay, frame } = args
    const parsed = metricsSampleEventSchema.safeParse(frame.event)
    if (!parsed.success) return
    if (this.relays.get(relay.sessionId) !== relay) return
    relay.ring.push(parsed.data.sample)
    if (relay.ring.length > METRICS_RING_SIZE) relay.ring.shift()
    if (!relay.ready) return
    void this.publish({
      sessionId: relay.sessionId,
      frame: { type: 'sample', sample: parsed.data.sample },
    })
  }

  private stop(args: { relay: RelayState; release: boolean }): void {
    const { relay } = args
    if (this.relays.get(relay.sessionId) !== relay) return
    this.relays.delete(relay.sessionId)
    clearTimeout(relay.timer)
    relay.dispose()
    relay.watchers.clear()
    relay.ring = []
    if (args.release) void this.release(relay.sessionId)
  }

  private release(sessionId: string): Promise<void> {
    return this.args.ops.invoke({ sessionId, op: { op: 'metrics.unsubscribe' } }).then(
      () => undefined,
      (error: unknown) => {
        this.args.log?.warn({
          source: 'bus.pod-metrics',
          message: `releasing pod metrics for ${sessionId} failed`,
          data: { error: error instanceof Error ? error.message : String(error) },
        })
      },
    )
  }

  private publish(args: { sessionId: string; frame: PodMetricsFrame }): Promise<void> {
    return this.args.bus.publish(args).catch((error: unknown) => {
      this.args.log?.warn({
        source: 'bus.pod-metrics',
        message: `publishing pod metrics for ${args.sessionId} failed`,
        data: { error: error instanceof Error ? error.message : String(error) },
      })
    })
  }
}
