import { crashedCallsOf } from '@dltech/atlas-core'

import { settledWithin } from './crew/child-turns'
import { DRAIN_TOOL_CALL_CAP_MS } from './drain-cap'
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
      turns: HeldTurns
      ending: HeldEnding
      record(): SessionRecord | undefined
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
    const settled = await settledWithin({
      timers: this.args.deps.timers,
      ms: this.toolCallInFlight() ? DRAIN_TOOL_CALL_CAP_MS : this.args.deps.drainCapMs,
      done: this.args.turns.whenIdle(),
    })
    if (settled) return
    this.logCap({ startedAt })
    this.args.turns.abort('handoff')
  }

  private toolCallInFlight(): boolean {
    const state = this.args.record()?.eventCache().loopState()
    return state !== undefined && crashedCallsOf(state).length > 0
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
