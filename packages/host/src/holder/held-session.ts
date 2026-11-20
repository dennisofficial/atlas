import {
  crashedCallsOf,
  crashLooped,
  EHeldAction,
  EHeldOutcome,
  type HeldOutcome,
  type InboxEntry,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import { LoopTurnRunner, OPERATOR_STOP_REASON, PauseSignal } from '@dltech/atlas-agent'

import { FencedSettlement } from './fenced-settlement'
import { settleOperatorOnStop } from './operator-stop'
import type { SessionRuntime } from './ports'
import { CrewRoom } from './crew'
import {
  logDriveFault,
  logReconcileFault,
  ranQueuedCommand,
  settleAndCheckResume,
  startHeldTurn,
  wireHeldLoop,
} from './held-runner'
import { teardownHeld } from './held-teardown'
import { HeldPrepare } from './held-prepare'
import { readHeldAction } from './held-snapshot'
import { drainNeedsHolder } from './held-needs-holder'
import { lostOutcome } from './lost-outcome'
import { consumeStops } from './held-wait'
import { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'
import { HeldTurns } from './held-turns'
import { TakeOver } from './held-takeover'
import { quarantineOutcome } from './start-failure-record'
import { DRAIN_IN_FLIGHT_CAP_MS } from './drain-cap'
import { HeldEnding } from './held-ending'
import { HeldObservation } from './held-observation'

export type { HeldSessionDeps }

export class HeldSession {
  readonly sessionId: string
  private readonly deps: HeldSessionDeps
  private readonly lifetimeAbort = new AbortController()
  private readonly pause = new PauseSignal()
  private readonly turns: HeldTurns
  private readonly prepare: HeldPrepare
  private draining = false
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private observation: HeldObservation | undefined
  private branchesReady: Promise<void> = Promise.resolve()
  private crew: CrewRoom | undefined
  private reconciler: Reconciler | undefined
  private readonly fenced: FencedSettlement
  private readonly ending: HeldEnding
  runtimeOf(): SessionRuntime | undefined {
    return this.runtime
  }

  private resumeAfterSeq = 0
  private settleFence = true
  private takeOver: TakeOver | undefined
  private logStaged: (() => Promise<void>) | undefined
  private runCommands: ((entries: readonly InboxEntry[]) => Promise<boolean>) | undefined

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.turns = new HeldTurns(deps)
    this.turns.onTurnEnd = () => {
      this.observation?.turnEnded()
      this.reconciler?.request()
    }
    this.prepare = new HeldPrepare({
      deps,
      abandoned: () => this.draining || this.ending.outcome !== undefined,
      onSettled: ({ failed }) => {
        if (failed) this.ending.finish(EHeldOutcome.Idle)
        else this.reconciler?.request()
      },
      onSetupEnded: () => {
        this.reconciler?.request()
      },
    })
    this.fenced = new FencedSettlement(deps)
    this.ending = new HeldEnding({
      sessionId: this.sessionId,
      deps,
      lifetimeAbort: this.lifetimeAbort,
      turns: this.turns,
      isDraining: () => this.draining,
      branches: () => this.observation?.observer,
      record: () => this.record,
      runtime: () => this.runtime,
      reconciler: () => this.reconciler,
      beforeRelease: () => this.observation?.observeBeforeRelease() ?? Promise.resolve(),
    })
  }

  notifyWake(): void {
    if (this.draining || this.ending.outcome !== undefined) return
    this.reconciler?.request()
  }

  beginDrain(): void {
    this.draining = true
    this.observation?.drain()
    this.pause.pause()
    this.record?.markDraining()
    this.reconciler?.request()
  }

  run(args: { lease: Lease; threadId: ThreadId; claimMs?: number }): Promise<HeldOutcome> {
    this.ending.begin(args.lease.epoch)
    return this.drive(args)
  }

  discard(): void {
    this.beginDrain()
    this.ending.lose()
  }

  async handoff(): Promise<void> {
    this.beginDrain()
    this.runtime?.remoteCalls.handoff()
    const children = this.crew?.pauseAll()
    await this.settleInFlight()
    await children
    await this.ending.handBack({
      needsHolder: await drainNeedsHolder({
        deps: this.deps,
        record: this.record,
        turnRunning: this.turns.turnRunning,
      }),
    })
  }

  private async settleInFlight(): Promise<void> {
    if (!this.turns.turnRunning) return
    const startedAt = this.deps.timers.now()
    await new Promise<void>((resolve) => {
      const timer = this.deps.timers.setTimeout(() => {
        this.logDrainCap({ startedAt })
        this.turns.abort('handoff')
        resolve()
      }, DRAIN_IN_FLIGHT_CAP_MS)
      void this.turns.whenIdle().then(() => {
        this.deps.timers.clearTimeout(timer)
        resolve()
      })
    })
  }

  private logDrainCap(args: { startedAt: number }): void {
    const state = this.record?.eventCache().loopState()
    const call = state === undefined ? undefined : crashedCallsOf(state)[0]
    const inFlight = call === undefined ? 'an in-flight model step' : `the tool call ${call.name}`
    this.deps.log?.warn({
      source: 'holder.drain',
      message: `session ${this.sessionId} ran ${inFlight} for ${this.deps.timers.now() - args.startedAt}ms, past the ${DRAIN_IN_FLIGHT_CAP_MS}ms drain cap; aborting the turn`,
    })
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
    await this.observation?.stop()
    await this.crew
      ?.close({ draining: this.draining })
      .catch((error: unknown) => logDriveFault({ deps: this.deps, error }))
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
    const { runner, branches, branchesStarted, recoverCommands, runCommands, logStaged } =
      wireHeldLoop({
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
    this.observation = new HeldObservation({ deps, runtime, record, branches })
    this.observation.start()
    this.logStaged = logStaged
    this.runCommands = runCommands
    await settleAndCheckResume({ deps, runtime, record, threadId, crew })
    await recoverCommands()
    this.branchesReady = branchesStarted
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

  private async step(args: { runner: LoopTurnRunner; threadId: ThreadId }): Promise<void> {
    if (this.ending.outcome !== undefined) return
    const deps = this.deps
    const turnRunning = this.turns.turnRunning
    if (this.draining) return turnRunning ? undefined : this.ending.finish(EHeldOutcome.Drained)
    const { entries, action, resumable, inboxHead, failure } = await readHeldAction({
      deps,
      draining: this.draining,
      turnRunning,
      resumeAfterSeq: this.resumeAfterSeq,
      runtime: this.runtime,
      record: this.record,
      preparing: this.prepare.running,
      setupRunning: this.prepare.hasSetupRunning,
      childrenRunning: this.crew?.runningCount() ?? 0,
    })
    if (action === EHeldAction.AbortTurn) return this.turns.abort(OPERATOR_STOP_REASON)
    if (action !== EHeldAction.StartTurn) await this.logStaged?.()
    if (await ranQueuedCommand({ action, entries, turnRunning, runCommands: this.runCommands })) {
      this.reconciler?.request()
      return
    }
    switch (action) {
      case EHeldAction.ConsumeStop: {
        await settleOperatorOnStop({ deps, record: this.record, runtime: this.runtime })
        await this.prepare.failStopped()
        await consumeStops({ deps, record: this.record, entries })
        this.resumeAfterSeq = this.record?.eventCache().currentHead().seq ?? this.resumeAfterSeq
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
        await this.branchesReady
        if (this.draining || this.ending.outcome !== undefined) return
        this.takeOver?.firstStep()
        this.resumeAfterSeq = this.record?.eventCache().currentHead().seq ?? this.resumeAfterSeq
        startHeldTurn({
          deps,
          turns: this.turns,
          pause: this.pause,
          runner: args.runner,
          threadId: args.threadId,
          resume: resumable,
          refreshBranches: () => {
            if (this.draining || this.ending.outcome !== undefined) return
            this.observation?.refreshBranches()
          },
          onFault: () => this.ending.finish(EHeldOutcome.Faulted),
          onSettled: () => this.reconciler?.request(),
        })
        return
      }
      case EHeldAction.Release: {
        await this.ending.releaseIdle({ entries, failure, threadId: args.threadId })
        return
      }
      case EHeldAction.Wait: {
        return
      }
    }
  }

  losePresence(): void {
    this.settleFence = false
    this.ending.lose()
  }
}
