import type { ThreadId } from '@dltech/atlas-core'

import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import { SessionRecord } from './record/record-adapter'
import { RecordCache } from './record/record-cache'

type Timed<T> = { value: T; ms: number }

const timed = async <T>(deps: HeldSessionDeps, work: () => Promise<T>): Promise<Timed<T>> => {
  const startedAt = deps.timers.now()
  const value = await work()
  return { value, ms: deps.timers.now() - startedAt }
}

export class TakeOver {
  private readonly startedAt: number
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
    drainDeadline(): number | undefined
    onLeaseLost(): void
    onRuntime(runtime: SessionRuntime): void
  }): Promise<{ runtime: SessionRuntime; record: SessionRecord }> {
    const { deps } = this
    const [runtime, cache] = await Promise.all([
      timed(deps, () =>
        deps.runtimeFor({
          sessionId: deps.sessionId,
          threadId: args.threadId,
          epoch: args.epoch,
          signal: args.signal,
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
      drainDeadline: args.drainDeadline,
      nowIso: () => new Date(deps.timers.now()).toISOString(),
      onLeaseLost: args.onLeaseLost,
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
}
