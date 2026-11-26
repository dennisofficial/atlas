import { EHeldAction, EHeldOutcome, type InboxEntry, type ThreadId } from '@dltech/atlas-core'
import { OPERATOR_STOP_REASON, type LoopTurnRunner, type PauseSignal } from '@dltech/atlas-agent'
import { EFirstAction, logFieldsOf } from '@dltech/atlas-observability'

import { retryChildrenIn } from './child-retry'
import type { ContextSeedGate } from './context-seed'
import type { HeldEnding } from './held-ending'
import type { HeldObservation } from './held-observation'
import type { HeldPrepare } from './held-prepare'
import { ranQueuedCommand } from './held-runner'
import type { HeldSessionDeps } from './held-session-deps'
import { readHeldAction } from './held-snapshot'
import type { HeldTurns } from './held-turns'
import { startHeldTurn } from './held-turns'
import { isResizeEntry } from './held-inbox'
import { handleResizeEntries, reconcileResizeGate } from './held-resize'
import { ETakeoverLap, type TakeOverFirstStep } from './held-takeover'

type FirstStepWaiting = Omit<TakeOverFirstStep, 'action'>
import { consumeStops } from './held-wait'
import { settleOperatorOnStop } from './operator-stop'
import { closeOpenTurn } from './orphan-turn'
import { oweOwnStoppedTurn } from './stop-debts'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { STOPPED_BY_OPERATOR } from './turn-boundary'

export type Lapped = <T>(args: { lap: ETakeoverLap; work: () => Promise<T> }) => Promise<T>

export class HeldActions {
  private resumeAfterSeq = 0
  private shellsOwedSince: number | undefined
  private staged: (() => Promise<readonly InboxEntry[] | undefined>) | undefined
  private commands: ((entries: readonly InboxEntry[]) => Promise<boolean>) | undefined
  private retryChild: ((agentId: string) => Promise<boolean>) | undefined

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      turns: HeldTurns
      prepare: HeldPrepare
      seed: ContextSeedGate
      ending: HeldEnding
      pause: PauseSignal
      draining(): boolean
      runtime(): SessionRuntime | undefined
      record(): SessionRecord | undefined
      observation(): HeldObservation | undefined
      childrenRunning(): number
      takeOverFirstStep(first: TakeOverFirstStep): void
      request(): void
    },
  ) {}

  attach(args: {
    logStaged: () => Promise<readonly InboxEntry[] | undefined>
    runCommands: (entries: readonly InboxEntry[]) => Promise<boolean>
    retryChild: (agentId: string) => Promise<boolean>
  }): void {
    this.staged = args.logStaged
    this.commands = args.runCommands
    this.retryChild = args.retryChild
  }

  async step(args: { runner: LoopTurnRunner; threadId: ThreadId; lap: Lapped }): Promise<void> {
    const { deps, ending, turns } = this.args
    if (ending.outcome !== undefined) return
    const turnRunning = turns.turnRunning
    if (this.args.draining()) return turnRunning ? undefined : ending.finish(EHeldOutcome.Drained)
    const snapshot = await args.lap({
      lap: ETakeoverLap.Decide,
      work: () =>
        readHeldAction({
          deps,
          threadId: args.threadId,
          draining: this.args.draining(),
          turnRunning,
          resumeAfterSeq: this.resumeAfterSeq,
          runtime: this.args.runtime(),
          record: this.args.record(),
          preparing: this.args.prepare.running,
          setupRunning: this.args.prepare.hasSetupRunning,
          childrenRunning: this.args.childrenRunning(),
          shellsOwedSince: this.shellsOwedSince,
        }),
    })
    this.shellsOwedSince = snapshot.shellsOwedSince
    const { entries, action, resumable, inboxHead, failure, preparedBefore, queuedAt } = snapshot
    const waiting = { promptWaiting: snapshot.promptWaiting, preparedBefore, queuedAt }
    reconcileResizeGate({ record: this.args.record(), runtime: this.args.runtime() })
    if (
      await handleResizeEntries({
        entries,
        record: this.args.record(),
        calls: this.args.runtime()?.remoteCalls,
        runId: () => this.args.deps.ids.nextRunId(),
      })
    ) {
      this.args.request()
      return
    }
    if (action === EHeldAction.AbortTurn) return this.stopTurn()
    if (
      action !== EHeldAction.StartTurn &&
      (await this.settleStagedResize(await this.staged?.()))
    ) {
      return
    }
    if (!turnRunning && (await this.retryChildren({ entries, threadId: args.threadId }))) {
      this.args.request()
      return
    }
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
        this.prepare({ threadId: args.threadId, inboxHead, waiting })
        return
      }
      case EHeldAction.StartTurn: {
        await this.startTurn({
          runner: args.runner,
          threadId: args.threadId,
          entries,
          lap: args.lap,
          resumable,
          waiting,
          inboxHead,
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

  private async stopTurn(): Promise<void> {
    const owed = oweOwnStoppedTurn({
      record: this.args.record(),
      runId: () => this.args.deps.ids.nextRunId(),
      ...(this.args.deps.log === undefined ? {} : { log: this.args.deps.log }),
    })
    this.args.turns.abort(OPERATOR_STOP_REASON)
    await owed
  }

  private async settleStagedResize(entries: readonly InboxEntry[] | undefined): Promise<boolean> {
    const resized = entries?.filter(isResizeEntry) ?? []
    if (resized.length === 0) return false
    const handled = await handleResizeEntries({
      entries: resized,
      record: this.args.record(),
      calls: this.args.runtime()?.remoteCalls,
      runId: () => this.args.deps.ids.nextRunId(),
    })
    if (handled) this.args.request()
    return handled
  }

  private async retryChildren(args: {
    entries: readonly InboxEntry[]
    threadId: ThreadId
  }): Promise<boolean> {
    const record = this.args.record()
    const retry = this.retryChild
    if (record === undefined || retry === undefined) return false
    return await retryChildrenIn({
      entries: args.entries,
      record,
      threadId: args.threadId,
      runId: () => this.args.deps.ids.nextRunId(),
      retry,
      ...(this.args.deps.log === undefined ? {} : { log: this.args.deps.log }),
    })
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

  private prepare(args: {
    threadId: ThreadId
    inboxHead: number
    waiting: FirstStepWaiting
  }): void {
    const runtime = this.args.runtime()
    const record = this.args.record()
    if (runtime === undefined || record === undefined) return
    this.args.takeOverFirstStep({ action: EFirstAction.Prepare, ...args.waiting })
    const started = !this.args.prepare.running
    this.args.prepare.start({
      runtime,
      record,
      threadId: args.threadId,
      inboxHead: args.inboxHead,
      promptWaiting: args.waiting.promptWaiting,
    })
    if (started && this.args.prepare.running) this.args.request()
  }

  private async startTurn(args: {
    runner: LoopTurnRunner
    threadId: ThreadId
    entries: readonly InboxEntry[]
    lap: Lapped
    resumable: boolean
    waiting: FirstStepWaiting
    inboxHead: number
  }): Promise<void> {
    const { deps, ending, turns } = this.args
    if (this.args.draining() || ending.outcome !== undefined) return
    const record = this.args.record()
    if (record === undefined) return
    const seeded = await args.lap({
      lap: ETakeoverLap.Seed,
      work: () => this.args.seed.ensure({ entries: args.entries }),
    })
    if (!seeded.ok) {
      await this.recordSeedFailure({
        record,
        threadId: args.threadId,
        inboxHead: args.inboxHead,
        reason: seeded.reason,
      })
      ending.finish(EHeldOutcome.Idle)
      return
    }
    this.args.takeOverFirstStep({ action: EFirstAction.Turn, ...args.waiting })
    this.resumeAfterSeq = record.eventCache().currentHead().seq ?? this.resumeAfterSeq
    if (args.waiting.preparedBefore) this.retryWake()
    startHeldTurn({
      deps,
      turns,
      record,
      pause: this.args.pause,
      runner: args.runner,
      threadId: args.threadId,
      resume: args.resumable,
      queuedAt: args.waiting.queuedAt,
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

  private async recordSeedFailure(args: {
    record: SessionRecord
    threadId: ThreadId
    inboxHead: number
    reason: string
  }): Promise<void> {
    await args.record
      .append({
        threadId: args.threadId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: [
          { type: 'workspace-prepare-failed', reason: args.reason, inboxHead: args.inboxHead },
        ],
      })
      .catch((error: unknown) => {
        this.args.deps.log?.error({
          source: 'holder.seed',
          message: `recording the missing attached files of ${this.args.deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      })
  }
}
