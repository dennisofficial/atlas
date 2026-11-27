import type { PauseSignal } from '@dltech/atlas-agent'
import { ESpan, logFieldsOf, spanWith, type TracePort } from '@dltech/atlas-observability'

import { settledWithin } from './crew/child-turns'
import { DRAIN_STREAM_ABORT_CAP_MS } from './drain-cap'
import type { HeldEnding } from './held-ending'
import { drainNeedsHolder, outcomeCommandPending } from './held-needs-holder'
import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import type { SessionRecord } from './record/record-adapter'

class DrainLaps {
  private readonly ms: Record<string, number> = {}

  constructor(private readonly now: () => number) {}

  async time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const startedAt = this.now()
    try {
      return await work()
    } finally {
      this.ms[name] = Math.max(0, this.now() - startedAt)
    }
  }

  values(): Record<string, number> {
    return { ...this.ms }
  }
}

export class HeldDrain {
  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      sessionId: string
      pause: PauseSignal
      turns: HeldTurns
      ending: HeldEnding
      record(): SessionRecord | undefined
      childrenPause(): Promise<void> | undefined
      childrenRunning(): number
      pendingHandoff(): void
      trace(): TracePort | undefined
    },
  ) {}

  handoff(): Promise<void> {
    const turnRunning = this.args.turns.turnRunning
    const children = this.args.childrenRunning()
    return spanWith(this.args.trace(), {
      name: ESpan.Drain,
      root: true,
      fields: { sessionId: this.args.sessionId, extra: { turnRunning, children } },
      run: async (span) => {
        const laps = new DrainLaps(() => this.args.deps.timers.now())
        const capped = await this.drainOnce(laps)
        span.set({
          timings: laps.values(),
          extra: { turnRunning, children, inFlightCapped: capped },
        })
      },
    })
  }

  private async drainOnce(laps: DrainLaps): Promise<boolean> {
    const children = this.args.childrenPause()
    this.args.pendingHandoff()
    const capped = await laps.time('inFlight', () => this.settleInFlight())
    await laps.time('children', () => children ?? Promise.resolve())
    await laps.time('recordTail', () => this.settleRecordTail())
    await laps.time('handBack', () => this.handBack())
    return capped
  }

  private async handBack(): Promise<void> {
    const record = this.args.record()
    const { plane, sessionId } = this.args.deps
    const commandUnfinished = await outcomeCommandPending({
      events: record?.eventCache().eventsAfter(0) ?? [],
      kindOf: async (inboxId) => (await plane.readInboxEntry({ sessionId, inboxId }))?.kind,
    })
    await this.args.ending.handBack({
      needsHolder:
        commandUnfinished ||
        (await drainNeedsHolder({
          deps: this.args.deps,
          record,
          turnRunning: this.args.turns.turnRunning,
        })),
    })
  }

  private async settleInFlight(): Promise<boolean> {
    if (!this.args.pause.modelStepRunning) return false
    const startedAt = this.args.deps.timers.now()
    const settled = await settledWithin({
      timers: this.args.deps.timers,
      ms: this.args.deps.drainCapMs,
      done: this.args.pause.whenModelIdle(),
    })
    if (settled) return false
    this.logCap({ startedAt })
    this.args.pause.abortModelStep()
    const aborted = await settledWithin({
      timers: this.args.deps.timers,
      ms: DRAIN_STREAM_ABORT_CAP_MS,
      done: this.args.pause.whenModelIdle(),
    })
    if (!aborted) {
      this.warn({
        message: `the model stream outlived the ${DRAIN_STREAM_ABORT_CAP_MS}ms abort; handing back without it`,
      })
    }
    return true
  }

  private async settleRecordTail(): Promise<void> {
    const record = this.args.record()
    if (record === undefined) return
    const written = await settledWithin({
      timers: this.args.deps.timers,
      ms: DRAIN_STREAM_ABORT_CAP_MS,
      done: record.flush(),
    })
    if (!written) {
      this.warn({
        message: `the record tail outlived its ${DRAIN_STREAM_ABORT_CAP_MS}ms cap; handing back without it`,
      })
    }
  }

  private warn(args: { message: string; error?: unknown }): void {
    this.args.deps.log?.warn({
      source: 'holder.drain',
      message: `session ${this.args.sessionId}: ${args.message}`,
      ...(args.error === undefined ? {} : logFieldsOf({ error: args.error })),
    })
  }

  private logCap(args: { startedAt: number }): void {
    this.args.deps.log?.warn({
      source: 'holder.drain',
      message: `session ${this.args.sessionId} ran the model step for ${this.args.deps.timers.now() - args.startedAt}ms, past the ${this.args.deps.drainCapMs}ms drain cap; aborting the model stream`,
    })
  }
}
