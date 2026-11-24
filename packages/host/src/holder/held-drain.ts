import { crashedCallsOf } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import { settledWithin } from './crew/child-turns'
import { DRAIN_DETACH_CAP_MS } from './drain-cap'
import type { HeldEnding } from './held-ending'
import { drainNeedsHolder, outcomeCommandPending } from './held-needs-holder'
import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export class HeldDrain {
  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      sessionId: string
      turns: HeldTurns
      ending: HeldEnding
      record(): SessionRecord | undefined
      runtime(): SessionRuntime | undefined
      childrenPause(): Promise<void> | undefined
    },
  ) {}

  async handoff(): Promise<void> {
    const children = this.args.childrenPause()
    await this.settleInFlight()
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

  private async settleInFlight(): Promise<void> {
    if (!this.args.turns.turnRunning) return
    const startedAt = this.args.deps.timers.now()
    await new Promise<void>((resolve) => {
      const timer = this.args.deps.timers.setTimeout(() => {
        void this.abortPastCap({ startedAt }).finally(resolve)
      }, this.args.deps.drainCapMs)
      void this.args.turns.whenIdle().then(() => {
        this.args.deps.timers.clearTimeout(timer)
        resolve()
      })
    })
  }

  private async abortPastCap(args: { startedAt: number }): Promise<void> {
    this.logCap(args)
    const detached = await settledWithin({
      timers: this.args.deps.timers,
      ms: DRAIN_DETACH_CAP_MS,
      done: this.detachInFlightCalls().catch((error: unknown) => {
        this.warn({ message: 'detaching the in-flight calls failed', error })
      }),
    })
    if (!detached) {
      this.warn({
        message: `detaching the in-flight calls outlived ${DRAIN_DETACH_CAP_MS}ms; handing back without them`,
      })
    }
    this.args.turns.abort('handoff')
  }

  private warn(args: { message: string; error?: unknown }): void {
    this.args.deps.log?.warn({
      source: 'holder.drain',
      message: `session ${this.args.sessionId}: ${args.message}`,
      ...(args.error === undefined ? {} : logFieldsOf({ error: args.error })),
    })
  }

  private async detachInFlightCalls(): Promise<void> {
    const record = this.args.record()
    const state = record?.eventCache().loopState()
    if (record === undefined || state === undefined) return
    const daemonTools = this.args.runtime()?.daemonTools
    for (const call of crashedCallsOf(state)) {
      if (daemonTools?.has(call.name) === true) continue
      await record.append({
        threadId: call.threadId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: [{ type: 'tool-dispatched', callId: call.callId, name: call.name, detached: true }],
      })
    }
  }

  private logCap(args: { startedAt: number }): void {
    const state = this.args.record()?.eventCache().loopState()
    const call = state === undefined ? undefined : crashedCallsOf(state)[0]
    const inFlight = call === undefined ? 'an in-flight model step' : `the tool call ${call.name}`
    this.args.deps.log?.warn({
      source: 'holder.drain',
      message: `session ${this.args.sessionId} ran ${inFlight} for ${this.args.deps.timers.now() - args.startedAt}ms, past the ${this.args.deps.drainCapMs}ms drain cap; aborting the turn`,
    })
  }
}
