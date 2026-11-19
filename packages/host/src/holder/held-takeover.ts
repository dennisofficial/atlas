import type { ThreadId } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { LeaseLostError } from './record/lease-lost-error'
import { SessionRecord } from './record/record-adapter'
import { RecordCache } from './record/record-cache'
import { spawnerOf } from './spawner-of'

type Timed<T> = { value: T; ms: number }

const timed = async <T>(deps: HeldSessionDeps, work: () => Promise<T>): Promise<Timed<T>> => {
  const startedAt = deps.timers.now()
  const value = await work()
  return { value, ms: deps.timers.now() - startedAt }
}

export class TakeOver {
  private readonly startedAt: number
  private epoch: number | undefined
  private cleared = false
  private configMs = 0
  private recordMs = 0
  private logged = false

  constructor(
    private readonly deps: HeldSessionDeps,
    private readonly claimMs: number,
  ) {
    this.startedAt = deps.timers.now()
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
    this.deps.log?.info({
      source: 'holder.takeover',
      message: `take-over of ${this.deps.sessionId} reached its first step`,
      data: {
        source: 'holder.takeover',
        sessionId: this.deps.sessionId,
        claimMs: this.claimMs,
        configMs: this.configMs,
        recordMs: this.recordMs,
        firstStepMs: this.deps.timers.now() - this.startedAt,
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
