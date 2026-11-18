import {
  crashLooped,
  EHeldAction,
  EHeldOutcome,
  type HeldOutcome,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import { LoopTurnRunner, OPERATOR_STOP_REASON, PauseSignal } from '@dltech/atlas-agent'

import { DaemonProcessPort } from '../calls/ports/process'
import { type ChangesCheckout, ChangesSnapshotter } from './changes/snapshotter'
import { runGit } from './checkouts/git'
import { FencedSettlement } from './fenced-settlement'
import { settleOperatorOnStop } from './operator-stop'
import type { SessionRuntime } from './ports'
import type { BranchObserver } from './branch-observer'
import { CrewRoom } from './crew'
import {
  logDriveFault,
  logReconcileFault,
  settleAndCheckResume,
  startHeldTurn,
  wireHeldLoop,
} from './held-runner'
import { teardownHeld } from './held-teardown'
import { HeldPrepare } from './held-prepare'
import { readHeldAction } from './held-snapshot'
import { IdleDeadline } from './idle-deadline'
import { lostOutcome } from './lost-outcome'
import { consumeStops } from './held-wait'
import { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'
import { HeldTurns } from './held-turns'
import { TakeOver } from './held-takeover'
import { quarantineOutcome } from './start-failure-record'
import { HeldEnding } from './held-ending'

export type { HeldSessionDeps }

export class HeldSession {
  readonly sessionId: string
  private readonly deps: HeldSessionDeps
  private readonly lifetimeAbort = new AbortController()
  private readonly pause = new PauseSignal()
  private readonly turns: HeldTurns
  private readonly prepare: HeldPrepare
  private draining = false
  private done: Promise<HeldOutcome> | undefined
  private lastActivityAt: number
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private branches: BranchObserver | undefined
  private changes: ChangesSnapshotter | undefined
  private crew: CrewRoom | undefined
  private reconciler: Reconciler | undefined
  private readonly idle: IdleDeadline
  private readonly fenced: FencedSettlement
  private readonly ending: HeldEnding
  runtimeOf(): SessionRuntime | undefined {
    return this.runtime
  }

  private resumeAfterSeq = 0
  private settleFence = true
  private takeOver: TakeOver | undefined
  private logStaged: (() => Promise<void>) | undefined

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.lastActivityAt = deps.timers.now()
    this.turns = new HeldTurns(deps)
    this.turns.onTurnEnd = () => {
      void this.changes?.snapshotNow()
    }
    this.prepare = new HeldPrepare({
      deps,
      abandoned: () => this.draining || this.ending.outcome !== undefined,
      onSettled: ({ failed }) => {
        this.noteActivity()
        if (failed) this.ending.finish(EHeldOutcome.Idle)
        else this.reconciler?.request()
      },
      onSetupEnded: () => {
        this.noteActivity()
        this.reconciler?.request()
      },
    })
    this.fenced = new FencedSettlement(deps)
    this.idle = new IdleDeadline({
      timers: deps.timers,
      idleMinutes: deps.idleMinutes,
      onDue: () => this.reconciler?.request(),
    })
    this.ending = new HeldEnding({
      sessionId: this.sessionId,
      deps,
      lifetimeAbort: this.lifetimeAbort,
      turns: this.turns,
      idle: this.idle,
      isDraining: () => this.draining,
      branches: () => this.branches,
      record: () => this.record,
      runtime: () => this.runtime,
      reconciler: () => this.reconciler,
    })
  }

  private readonly noteActivity = (): void => {
    this.lastActivityAt = this.deps.timers.now()
  }

  private headSeq(): number {
    return this.record?.eventCache().currentHead().seq ?? this.resumeAfterSeq
  }

  notifyWake(): void {
    if (this.draining || this.ending.outcome !== undefined) return
    this.reconciler?.request()
  }

  beginDrain(): void {
    this.draining = true
    this.branches?.stop()
    void this.changes?.stop()
    this.pause.pause()
    this.record?.markDraining()
    this.reconciler?.request()
  }

  run(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<HeldOutcome> {
    this.ending.begin(args.lease.epoch)
    return (this.done = this.drive(args))
  }

  discard(): void {
    this.beginDrain()
    this.ending.lose()
  }

  async handoff(): Promise<void> {
    this.beginDrain()
    this.runtime?.remoteCalls.handoff()
    this.turns.abort('handoff')
    await this.done
  }

  private async drive(args: {
    lease: Lease
    threadId: ThreadId
    claimMs?: number
  }): Promise<HeldOutcome> {
    try {
      await this.scope(args)
    } catch (error) {
      logDriveFault({ deps: this.deps, error })
      if (this.ending.outcome === undefined) await this.ending.settleFault({ ...args, error })
    }
    this.branches?.stop()
    if (this.changes !== undefined)
      await this.changes.stop().catch((error: unknown) => logDriveFault({ deps: this.deps, error }))
    await this.crew?.stopAll().catch((error: unknown) => logDriveFault({ deps: this.deps, error }))
    return teardownHeld({
      deps: this.deps,
      runtime: this.runtime,
      record: this.record,
      turnRunning: this.turns.turnRunning,
      kind: this.ending.outcome ?? EHeldOutcome.Faulted,
      released: this.ending.released,
      settleFence: this.settleFence,
      epoch: this.ending.epoch,
      fenced: this.fenced,
    })
  }

  private async scope(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<void> {
    const { lease, threadId } = args
    const { deps } = this
    if (crashLooped(lease)) {
      return this.ending.finish(await quarantineOutcome({ deps, lease, threadId }))
    }
    this.takeOver = new TakeOver(deps, args.claimMs ?? 0)
    const { runtime, record } = await this.takeOver.open({
      threadId,
      epoch: lease.epoch,
      signal: this.lifetimeAbort.signal,
      onLeaseLost: (error) => this.ending.lose(lostOutcome(error)),
      onRuntime: (opened) => {
        this.runtime = opened
      },
    })
    this.record = record
    if (this.lifetimeAbort.signal.aborted) return record.fence()
    if (this.draining) record.markDraining()
    const crew = new CrewRoom({
      deps,
      runtime,
      parentRecord: record,
      parentThreadId: threadId,
      epoch: lease.epoch,
      signal: this.lifetimeAbort.signal,
      onLeaseLost: (error) => this.ending.lose(lostOutcome(error)),
    })
    this.crew = crew
    const { runner, branches, recoverCommands, logStaged } = wireHeldLoop({
      deps,
      runtime,
      record,
      turns: this.turns,
      threadId,
      signal: this.lifetimeAbort.signal,
      epoch: lease.epoch,
      crew: crew.port(),
      isDraining: () => this.draining,
    })
    this.branches = branches
    this.logStaged = logStaged
    this.changes = this.changesOf({ runtime, record })
    this.changes?.start()
    await settleAndCheckResume({ deps, runtime, record, threadId })
    await recoverCommands()
    const completion = this.ending.waitForDrive()
    if (this.lifetimeAbort.signal.aborted || this.ending.outcome !== undefined) return
    const reconciler = new Reconciler({
      timers: deps.timers,
      step: () => this.step({ runner, threadId }),
      onError: (error) => logReconcileFault({ deps, error }),
    })
    this.reconciler = reconciler
    reconciler.request()
    await completion
  }

  private changesOf(args: {
    runtime: SessionRuntime
    record: SessionRecord
  }): ChangesSnapshotter | undefined {
    const content = this.deps.changes?.content
    if (content === undefined) return undefined
    const { deps } = this
    const processes = new DaemonProcessPort({ calls: args.runtime.remoteCalls })
    return new ChangesSnapshotter({
      sessionId: deps.sessionId,
      plane: deps.plane,
      content,
      remoteCalls: args.runtime.remoteCalls,
      checkouts: async () => {
        if (!args.record.eventCache().bookkeeping().workspace().prepared) return []
        const repos = await args.runtime.watchedRepos()
        const found: ChangesCheckout[] = []
        for (const repoPath of repos) {
          const origin = await runGit({
            processes,
            cwd: repoPath,
            argv: ['remote', 'get-url', 'origin'],
          })
          found.push({
            repoPath,
            originUrl: origin.ok ? origin.stdout.trim() : '',
            base: args.runtime.baseBranchOf(repoPath),
          })
        }
        return found
      },
      ...(deps.log === undefined ? {} : { log: deps.log }),
      now: () => deps.timers.now(),
    })
  }

  private async step(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    if (this.ending.outcome !== undefined) return
    const deps = this.deps
    const turnRunning = this.turns.turnRunning
    if (this.draining) return turnRunning ? undefined : this.ending.finish(EHeldOutcome.Drained)
    const { entries, action, resumable, inboxHead, shellsRunning } = await readHeldAction({
      deps,
      draining: this.draining,
      turnRunning,
      resumeAfterSeq: this.resumeAfterSeq,
      lastActivityAt: this.lastActivityAt,
      runtime: this.runtime,
      record: this.record,
      preparing: this.prepare.running,
      setupRunning: this.prepare.hasSetupRunning,
      childrenRunning: this.crew?.runningCount() ?? 0,
    })
    if (shellsRunning) this.noteActivity()
    if (action === EHeldAction.AbortTurn) return this.turns.abort(OPERATOR_STOP_REASON)
    if (action !== EHeldAction.StartTurn) await this.logStaged?.()
    switch (action) {
      case EHeldAction.ConsumeStop: {
        await settleOperatorOnStop({ deps, record: this.record, runtime: this.runtime })
        await consumeStops({ deps, record: this.record, entries, onActivity: this.noteActivity })
        this.resumeAfterSeq = this.headSeq()
        this.reconciler?.request()
        return
      }
      case EHeldAction.Prepare: {
        const { runtime, record } = this
        if (runtime === undefined || record === undefined) return
        this.takeOver?.firstStep()
        this.prepare.start({ runtime, record, threadId: args.threadId, inboxHead })
        return
      }
      case EHeldAction.StartTurn: {
        this.takeOver?.firstStep()
        this.resumeAfterSeq = this.headSeq()
        this.noteActivity()
        this.idle.disarm()
        startHeldTurn({
          deps,
          turns: this.turns,
          pause: this.pause,
          runner: args.runner,
          threadId: args.threadId,
          resume: resumable,
          onActivity: this.noteActivity,
          refreshBranches: () => {
            if (this.draining || this.ending.outcome !== undefined) return
            void this.branches?.refresh().catch((error) => logDriveFault({ deps, error }))
          },
          onFault: () => this.ending.finish(EHeldOutcome.Faulted),
          onSettled: () => this.reconciler?.request(),
        })
        return
      }
      case EHeldAction.Release: {
        await this.ending.releaseIdle()
        return
      }
      case EHeldAction.Wait: {
        if (turnRunning || this.prepare.running || this.prepare.hasSetupRunning) return
        this.idle.arm({ lastActivityAt: this.lastActivityAt })
      }
    }
  }

  losePresence(): void {
    this.settleFence = false
    this.ending.lose()
  }
}
