import { ERunFailureKind, type ThreadId } from '@dltech/atlas-core'
import { markFailureRecorded, recordRunFailure } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { HeldTurns } from './held-turns'
import { startHeldTurn } from './held-runner'
import { ProgressWatchdog } from './progress-watchdog'
import type { SessionRecord } from './record/record-adapter'
import { StalledTurnError } from './stalled-turn'

type StartTurnArgs = Omit<Parameters<typeof startHeldTurn>[0], 'deps' | 'turns' | 'onActivity'>

export const DEFAULT_STALL_AFTER_MS = 11 * 60_000

const minutesOf = (ms: number): number => Number((ms / 60_000).toFixed(2))

export class StallGuard {
  private readonly watchdog: ProgressWatchdog
  private threadId: ThreadId | undefined
  private stalled = false

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      turns: HeldTurns
      record(): SessionRecord | undefined
      onActivity(): void
      onStalled(): void
    },
  ) {
    this.watchdog = new ProgressWatchdog({
      timers: args.deps.timers,
      stallAfterMs: args.deps.stallAfterMs ?? DEFAULT_STALL_AFTER_MS,
      onStall: (stalledForMs) => void this.handleStall(stalledForMs),
    })
  }

  startTurn(args: StartTurnArgs): void {
    this.threadId = args.threadId
    this.stalled = false
    this.watchdog.arm()
    startHeldTurn({
      ...args,
      deps: this.args.deps,
      turns: this.args.turns,
      onActivity: () => {
        this.watchdog.touch()
        this.args.onActivity()
      },
      onFault: () => {
        this.watchdog.disarm()
        if (!this.stalled) args.onFault()
      },
      onSettled: () => {
        this.watchdog.disarm()
        args.onSettled()
      },
    })
  }

  private async handleStall(stalledForMs: number): Promise<void> {
    const { deps, turns } = this.args
    this.stalled = true
    const error = new StalledTurnError(minutesOf(stalledForMs))
    markFailureRecorded(error)
    turns.abort(error)
    try {
      const record = this.args.record()
      if (record !== undefined && this.threadId !== undefined) {
        await recordRunFailure({
          record,
          threadId: this.threadId,
          runId: deps.ids.nextRunId(),
          failure: { kind: ERunFailureKind.Stalled, message: error.message },
        })
      }
    } catch (appendError) {
      deps.log?.error({
        source: 'holder.stall',
        message: `recording the stalled turn of ${deps.sessionId} failed`,
        ...logFieldsOf({ error: appendError }),
      })
    }
    this.args.onActivity()
    this.args.onStalled()
  }
}
