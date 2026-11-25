import {
  podMetricsWindowOf,
  type PodMetricsWindow,
  type PodSample,
  type ThreadId,
} from '@dltech/atlas-core'
import { EAnalyticsThreadKind, type PodAnalytics } from '@dltech/atlas-plugin-sdk'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { metricsSampleEventSchema } from '@dltech/atlas-protocol'

import { newKey, type EventFrame, type RemoteCalls } from '../calls/remote-calls'
import type { HeldSessionDeps } from './held-session-deps'
import { analyticsOf } from './pod-analytics'
import type { HostTimers, SessionRuntime } from './ports'

export const POD_SAMPLE_WINDOW_MS = 60_000

export type PodSampleObserverArgs = {
  remoteCalls: Pick<RemoteCalls, 'onEvent' | 'invoke' | 'ack' | 'onReady'>
  analytics: PodAnalytics | undefined
  timers: HostTimers
  windowMs?: number | undefined
  log?: LogPort | undefined
}

export class PodSampleObserver {
  private readonly windowMs: number
  private buffer: PodSample[] = []
  private windowStart = 0
  private oomKillsBefore: number | null = null
  private turnActive = false
  private subscribed = false
  private warned = false
  private timer: unknown
  private unsubscribeEvent: (() => void) | undefined
  private unsubscribeReady: (() => void) | undefined

  constructor(private readonly args: PodSampleObserverArgs) {
    this.windowMs = args.windowMs ?? POD_SAMPLE_WINDOW_MS
  }

  turnStarted(): Promise<void> {
    return this.guarded(() => this.begin())
  }

  turnEnded(): Promise<void> {
    return this.guarded(() => this.end())
  }

  stop(): Promise<void> {
    return this.guarded(async () => {
      this.release()
      this.buffer = []
      await this.unsubscribe()
    })
  }

  private async begin(): Promise<void> {
    if (this.args.analytics === undefined) return
    if (this.turnActive) return
    this.turnActive = true
    this.warned = false
    this.buffer = []
    this.windowStart = this.args.timers.now()
    this.oomKillsBefore = null
    await this.attachAndSubscribe()
  }

  private async end(): Promise<void> {
    const wasActive = this.turnActive
    this.release()
    if (!wasActive) return
    this.flush()
    await this.unsubscribe()
  }

  private async guarded(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      this.warn('sampling the pod resources failed', error)
    }
  }

  private release(): void {
    this.turnActive = false
    this.disarm()
    this.detach()
  }

  private async attachAndSubscribe(): Promise<void> {
    this.disarm()
    this.attach()
    this.arm()
    await this.subscribe()
  }

  private attach(): void {
    this.unsubscribeEvent ??= this.args.remoteCalls.onEvent((frame) => this.received(frame))
    this.unsubscribeReady ??= this.args.remoteCalls.onReady(() => this.ready())
  }

  private detach(): void {
    this.unsubscribeEvent?.()
    this.unsubscribeEvent = undefined
    this.unsubscribeReady?.()
    this.unsubscribeReady = undefined
  }

  private received(frame: EventFrame): void {
    if (!this.turnActive) return
    const parsed = metricsSampleEventSchema.safeParse(frame.event)
    if (!parsed.success) return
    const sample = parsed.data.sample
    if (sample.at < this.windowStart) return
    this.buffer.push(sample)
  }

  private ready(): void {
    if (!this.turnActive) return
    this.subscribed = false
    void this.attachAndSubscribe()
  }

  private arm(): void {
    this.timer = this.args.timers.setTimeout(() => this.armed(), this.windowMs)
  }

  private disarm(): void {
    if (this.timer === undefined) return
    this.args.timers.clearTimeout(this.timer)
    this.timer = undefined
  }

  private armed(): void {
    this.timer = undefined
    if (!this.turnActive) return
    this.flush()
    this.arm()
  }

  private flush(): void {
    const endedAt = this.args.timers.now()
    const samples = this.buffer.filter((sample) => sample.at < endedAt)
    this.buffer = this.buffer.filter((sample) => sample.at >= endedAt)
    const startedAt = this.windowStart
    this.windowStart = endedAt
    if (samples.length === 0) return
    const window = podMetricsWindowOf({
      samples,
      from: startedAt,
      to: endedAt,
      oomKillsBefore: this.oomKillsBefore,
    })
    this.oomKillsBefore = samples[samples.length - 1]?.oomKills ?? this.oomKillsBefore
    if (window === null) return
    this.capture(window)
  }

  private capture(window: PodMetricsWindow): void {
    try {
      this.args.analytics?.capture({
        event: 'pod_resource_sample',
        properties: {
          window_ms: window.windowMs,
          samples: window.samples,
          ram_peak_bytes: window.ramPeakBytes,
          ram_avg_bytes: window.ramAvgBytes,
          ...(window.ramLimitBytes === undefined ? {} : { ram_limit_bytes: window.ramLimitBytes }),
          ...(window.ramPeakRatio === undefined ? {} : { ram_peak_ratio: window.ramPeakRatio }),
          cpu_peak_percent: window.cpuPeakPercent,
          cpu_avg_percent: window.cpuAvgPercent,
          throttled_ratio: window.throttledRatio,
          ...(window.diskUsedBytes === undefined ? {} : { disk_used_bytes: window.diskUsedBytes }),
          ...(window.diskLimitBytes === undefined
            ? {}
            : { disk_limit_bytes: window.diskLimitBytes }),
          oom_kills: window.oomKills,
        },
      })
    } catch (error) {
      this.warn('capturing a pod resource sample failed', error)
    }
  }

  private async subscribe(): Promise<void> {
    const result = await this.invoke('metrics.subscribe')
    if (result) {
      this.subscribed = true
      return
    }
    this.disarm()
    this.detach()
  }

  private async unsubscribe(): Promise<void> {
    if (!this.subscribed) return
    this.subscribed = false
    await this.invoke('metrics.unsubscribe')
  }

  private async invoke(op: 'metrics.subscribe' | 'metrics.unsubscribe'): Promise<boolean> {
    const key = newKey()
    try {
      const result = await this.args.remoteCalls.invoke({ key, op: { op } })
      await this.args.remoteCalls.ack({ key })
      if (result.status !== 'ok' || result.op !== op) {
        this.warnOnce(`the pod did not ${op} for the resource samples`)
        return false
      }
      return true
    } catch (error) {
      this.warnOnce(`the pod did not ${op} for the resource samples`, error)
      return false
    }
  }

  private warnOnce(message: string, error?: unknown): void {
    if (this.warned) return
    this.warned = true
    this.warn(message, error)
  }

  private warn(message: string, error?: unknown): void {
    this.args.log?.warn({
      source: 'holder.pod-samples',
      message,
      ...(error === undefined ? {} : logFieldsOf({ error })),
    })
  }
}

export const podSampleObserverOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  threadId: ThreadId
}): PodSampleObserver =>
  new PodSampleObserver({
    remoteCalls: args.runtime.remoteCalls,
    analytics:
      args.runtime.analytics === undefined
        ? undefined
        : analyticsOf({
            analytics: args.runtime.analytics,
            sessionId: args.deps.sessionId,
            threadId: args.threadId,
            threadKind: EAnalyticsThreadKind.Main,
          }),
    timers: args.deps.timers,
    ...(args.deps.log === undefined ? {} : { log: args.deps.log }),
  })
