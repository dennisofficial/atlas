import type { PauseSignal } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import { settledWithin } from './crew/child-turns'
import { DRAIN_STREAM_ABORT_CAP_MS } from './drain-cap'
import type { HeldEnding } from './held-ending'
import { drainNeedsHolder, outcomeCommandPending } from './held-needs-holder'
import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import type { SessionRecord } from './record/record-adapter'

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
      pendingHandoff(): void
    },
  ) {}

  async handoff(): Promise<void> {
    const children = this.args.childrenPause()
    this.args.pendingHandoff()
    await this.settleModelStream()
    await this.settleRecordTail()
    await children
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

  private async settleModelStream(): Promise<void> {
    if (!this.args.turns.turnRunning) return
    const startedAt = this.args.deps.timers.now()
    const idle = await settledWithin({
      timers: this.args.deps.timers,
      ms: this.args.deps.drainCapMs,
      done: this.args.pause.whenModelIdle(),
    })
    if (idle) return
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
      message: `session ${this.args.sessionId} ran an in-flight model step for ${this.args.deps.timers.now() - args.startedAt}ms, past the ${this.args.deps.drainCapMs}ms drain cap; aborting the model stream`,
    })
  }
}
