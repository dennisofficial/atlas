import { EHeldAction, EHeldOutcome, type InboxEntry, type ThreadId } from '@dltech/atlas-core'
import { OPERATOR_STOP_REASON, type LoopTurnRunner, type PauseSignal } from '@dltech/atlas-agent'

import type { HeldEnding } from './held-ending'
import type { HeldObservation } from './held-observation'
import type { HeldPrepare } from './held-prepare'
import { ranQueuedCommand, startHeldTurn } from './held-runner'
import type { HeldSessionDeps } from './held-session-deps'
import { readHeldAction } from './held-snapshot'
import type { HeldTurns } from './held-turns'
import { ETakeoverLap } from './held-takeover'
import { consumeStops } from './held-wait'
import { settleOperatorOnStop } from './operator-stop'
import { closeOpenTurn } from './orphan-turn'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { STOPPED_BY_OPERATOR } from './turn-boundary'

export type Lapped = <T>(args: { lap: ETakeoverLap; work: () => Promise<T> }) => Promise<T>

export class HeldActions {
  private resumeAfterSeq = 0
  private staged: (() => Promise<void>) | undefined
  private commands: ((entries: readonly InboxEntry[]) => Promise<boolean>) | undefined

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      turns: HeldTurns
      prepare: HeldPrepare
      ending: HeldEnding
      pause: PauseSignal
      draining(): boolean
      runtime(): SessionRuntime | undefined
      record(): SessionRecord | undefined
      observation(): HeldObservation | undefined
      childrenRunning(): number
      takeOverFirstStep(): void
      request(): void
    },
  ) {}

  attach(args: {
    logStaged: () => Promise<void>
    runCommands: (entries: readonly InboxEntry[]) => Promise<boolean>
  }): void {
    this.staged = args.logStaged
    this.commands = args.runCommands
  }

  async step(args: { runner: LoopTurnRunner; threadId: ThreadId; lap: Lapped }): Promise<void> {
    const { deps, ending, turns } = this.args
    if (ending.outcome !== undefined) return
    const turnRunning = turns.turnRunning
    if (this.args.draining()) return turnRunning ? undefined : ending.finish(EHeldOutcome.Drained)
    const { entries, action, resumable, inboxHead, failure, preparedBefore } = await args.lap({
      lap: ETakeoverLap.Decide,
      work: () =>
        readHeldAction({
          deps,
          draining: this.args.draining(),
          turnRunning,
          resumeAfterSeq: this.resumeAfterSeq,
          runtime: this.args.runtime(),
          record: this.args.record(),
          preparing: this.args.prepare.running,
          setupRunning: this.args.prepare.hasSetupRunning,
          childrenRunning: this.args.childrenRunning(),
        }),
    })
    if (action === EHeldAction.AbortTurn) return turns.abort(OPERATOR_STOP_REASON)
    if (action !== EHeldAction.StartTurn) await this.staged?.()
    if (await ranQueuedCommand({ action, entries, turnRunning, runCommands: this.commands })) {
      this.args.request()
      return
    }
    switch (action) {
      case EHeldAction.ConsumeStop: {
        await this.consumeStop({ entries })
        return
      }
      case EHeldAction.Prepare: {
        this.prepare({ threadId: args.threadId, inboxHead })
        return
      }
      case EHeldAction.StartTurn: {
        this.startTurn({
          runner: args.runner,
          threadId: args.threadId,
          resumable,
          preparedBefore,
        })
        return
      }
      case EHeldAction.Release: {
        await ending.releaseIdle({ entries, failure, threadId: args.threadId })
        return
      }
      case EHeldAction.Wait: {
        return
      }
    }
  }

  private async consumeStop(args: { entries: readonly InboxEntry[] }): Promise<void> {
    const { deps, turns } = this.args
    const record = this.args.record()
    await settleOperatorOnStop({ deps, record, runtime: this.args.runtime() })
    if (!this.args.prepare.resumed) await this.args.prepare.failStopped()
    await consumeStops({ deps, record, entries: args.entries })
    if (!turns.turnRunning) await closeOpenTurn({ deps, record, ending: STOPPED_BY_OPERATOR })
    this.resumeAfterSeq = record?.eventCache().currentHead().seq ?? this.resumeAfterSeq
    this.args.request()
  }

  private prepare(args: { threadId: ThreadId; inboxHead: number }): void {
    const runtime = this.args.runtime()
    const record = this.args.record()
    if (runtime === undefined || record === undefined) return
    this.args.takeOverFirstStep()
    const started = !this.args.prepare.running
    this.args.prepare.start({ runtime, record, threadId: args.threadId, inboxHead: args.inboxHead })
    if (started && this.args.prepare.running) this.args.request()
  }

  private startTurn(args: {
    runner: LoopTurnRunner
    threadId: ThreadId
    resumable: boolean
    preparedBefore: boolean
  }): void {
    const { deps, ending, turns } = this.args
    if (this.args.draining() || ending.outcome !== undefined) return
    const record = this.args.record()
    if (record === undefined) return
    this.args.takeOverFirstStep()
    this.resumeAfterSeq = record.eventCache().currentHead().seq ?? this.resumeAfterSeq
    if (args.preparedBefore) this.retryWake()
    startHeldTurn({
      deps,
      turns,
      record,
      pause: this.args.pause,
      runner: args.runner,
      threadId: args.threadId,
      resume: args.resumable,
      refreshBranches: () => {
        if (this.args.draining() || ending.outcome !== undefined) return
        this.args.observation()?.refreshBranches()
      },
      onFault: () => ending.finish(EHeldOutcome.Faulted),
      onSettled: () => this.args.request(),
    })
  }

  private retryWake(): void {
    const runtime = this.args.runtime()
    if (runtime?.workspaceGate?.settled !== 'failed') return
    void runtime.prepare().catch(() => undefined)
  }
}
