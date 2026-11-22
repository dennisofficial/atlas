import { crashedCallsOf } from '@dltech/atlas-core'

import { DRAIN_IN_FLIGHT_CAP_MS } from './drain-cap'
import type { HeldEnding } from './held-ending'
import { drainNeedsHolder } from './held-needs-holder'
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
    await this.args.ending.handBack({
      needsHolder: await drainNeedsHolder({
        deps: this.args.deps,
        record: this.args.record(),
        turnRunning: this.args.turns.turnRunning,
      }),
    })
  }

  private async settleInFlight(): Promise<void> {
    if (!this.args.turns.turnRunning) return
    const startedAt = this.args.deps.timers.now()
    await new Promise<void>((resolve) => {
      const timer = this.args.deps.timers.setTimeout(() => {
        void this.abortPastCap({ startedAt }).then(() => resolve())
      }, DRAIN_IN_FLIGHT_CAP_MS)
      void this.args.turns.whenIdle().then(() => {
        this.args.deps.timers.clearTimeout(timer)
        resolve()
      })
    })
  }

  private async abortPastCap(args: { startedAt: number }): Promise<void> {
    this.logCap(args)
    await this.detachInFlightCalls()
    this.args.turns.abort('handoff')
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
      message: `session ${this.args.sessionId} ran ${inFlight} for ${this.args.deps.timers.now() - args.startedAt}ms, past the ${DRAIN_IN_FLIGHT_CAP_MS}ms drain cap; aborting the turn`,
    })
  }
}
