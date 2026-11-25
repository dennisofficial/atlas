import type { ThreadId } from '@dltech/atlas-core'
import {
  ESpan,
  logFieldsOf,
  spanWith,
  type LogPort,
  type TracePort,
} from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { LeaseLostError } from './record/lease-lost-error'
import { SessionRecord } from './record/record-adapter'
import { RecordCache } from './record/record-cache'
import { spawnerOf } from './spawner-of'

type Timed<T> = { value: T; ms: number }

export enum ETakeoverLap {
  Branches = 'branches',
  Commands = 'commands',
  Decide = 'decide',
  Settle = 'settle',
}

const timed = async <T>(deps: HeldSessionDeps, work: () => Promise<T>): Promise<Timed<T>> => {
  const startedAt = deps.timers.now()
  const value = await work()
  return { value, ms: deps.timers.now() - startedAt }
}

const msOf = (timings: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(timings).map(([key, ms]) => [`${key}Ms`, ms]))

export class TakeOver {
  private readonly startedAt: number
  private trace: TracePort | undefined
  private epoch: number | undefined
  private cleared = false
  private configMs = 0
  private recordMs = 0
  private logged = false
  private readonly laps = new Map<ETakeoverLap, number>()

  constructor(
    private readonly deps: HeldSessionDeps,
    private readonly claimMs: number,
  ) {
    this.startedAt = deps.timers.now()
  }

  async lapped<T>(args: { lap: ETakeoverLap; work: () => Promise<T> }): Promise<T> {
    const startedAt = this.deps.timers.now()
    const value = await args.work()
    this.lap({ lap: args.lap, ms: this.deps.timers.now() - startedAt })
    return value
  }

  private lap(args: { lap: ETakeoverLap; ms: number }): void {
    this.laps.set(args.lap, args.ms)
    if (args.lap === ETakeoverLap.Branches && this.logged) this.logBranchesTail(args.ms)
  }

  branchesSettled(): void {
    this.lap({ lap: ETakeoverLap.Branches, ms: this.deps.timers.now() - this.startedAt })
  }

  async open(args: {
    threadId: ThreadId
    epoch: number
    signal: AbortSignal
    onLeaseLost(error: LeaseLostError): void
    onRuntime(runtime: SessionRuntime): void
  }): Promise<{ runtime: SessionRuntime; record: SessionRecord }> {
    const { deps } = this
    this.epoch = args.epoch
    const [runtime, cache] = await Promise.all([
      timed(deps, async () =>
        deps.runtimeFor({
          sessionId: deps.sessionId,
          podSessionId: deps.podSessionId,
          podPeers: deps.podPeers,
          threadId: args.threadId,
          epoch: args.epoch,
          signal: args.signal,
          spawner: await spawnerOf({
            plane: deps.plane,
            sessionId: deps.sessionId,
          }),
        }),
      ).then((result) => {
        this.configMs = result.ms
        this.trace = result.value.trace
        args.onRuntime(result.value)
        return result.value
      }),
      timed(deps, () =>
        RecordCache.load({
          plane: deps.plane,
          threadId: args.threadId,
          ...(deps.log === undefined ? {} : { log: deps.log }),
        }),
      ).then((result) => {
        this.recordMs = result.ms
        return result.value
      }),
    ])
    const record = await SessionRecord.open({
      plane: deps.plane,
      threadId: args.threadId,
      epoch: args.epoch,
      timers: deps.timers,
      remoteCalls: runtime.remoteCalls,
      daemonTools: runtime.daemonTools,
      ...(runtime.pictures === undefined ? {} : { pictures: runtime.pictures }),
      appendRetryMs: deps.appendRetryMs,
      nowIso: () => new Date(deps.timers.now()).toISOString(),
      onLeaseLost: args.onLeaseLost,
      onStepAppended: () => this.forgetFailedStarts(),
      preloaded: cache,
      ...(deps.log === undefined ? {} : { log: deps.log }),
    })
    return { runtime, record }
  }

  firstStep(): void {
    if (this.logged) return
    this.logged = true
    const timings = this.timingsOf()
    void spanWith(this.trace, {
      name: ESpan.Takeover,
      root: true,
      fields: { sessionId: this.deps.sessionId, timings },
      run: async () => undefined,
    })
    this.deps.log?.info({
      source: 'holder.takeover',
      message: `take-over of ${this.deps.sessionId} reached its first step`,
      data: {
        source: 'holder.takeover',
        sessionId: this.deps.sessionId,
        ...msOf(timings),
      },
    })
  }

  private timingsOf(): Record<string, number> {
    return {
      claim: this.claimMs,
      config: this.configMs,
      record: this.recordMs,
      ...Object.fromEntries(this.laps),
      firstStep: this.deps.timers.now() - this.startedAt,
    }
  }

  private logBranchesTail(branchesMs: number): void {
    this.deps.log?.info({
      source: 'holder.takeover',
      message: `take-over of ${this.deps.sessionId} observed its branches after the first step`,
      data: {
        source: 'holder.takeover',
        sessionId: this.deps.sessionId,
        branchesMs,
        afterFirstStepMs: this.deps.timers.now() - this.startedAt,
      },
    })
  }

  private forgetFailedStarts(): void {
    if (this.cleared) return
    this.cleared = true
    const epoch = this.epoch
    if (epoch === undefined) return
    void this.deps.plane
      .clearStartAttempts({ sessionId: this.deps.sessionId, epoch })
      .catch((error: unknown) => this.logFault(error))
  }

  private logFault(error: unknown): void {
    const log: LogPort | undefined = this.deps.log
    log?.error({
      source: 'holder.takeover',
      message: `clearing the start attempts of ${this.deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })
  }
}
