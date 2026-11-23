import {
  crashLooped,
  EHeldOutcome,
  type HeldOutcome,
  type Lease,
  type ThreadId,
} from '@dltech/atlas-core'
import { PauseSignal } from '@dltech/atlas-agent'

import { FencedSettlement } from './fenced-settlement'
import type { SessionRuntime } from './ports'
import { ContextSeedGate } from './context-seed'
import { CrewRoom } from './crew'
import { logDriveFault, logReconcileFault, settleAndCheckResume, wireHeldLoop } from './held-runner'
import { teardownHeld } from './held-teardown'
import { HeldPrepare } from './held-prepare'
import { lostOutcome } from './lost-outcome'
import { Reconciler } from './reconciler'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'
import { HeldTurns } from './held-turns'
import { ETakeoverLap, TakeOver } from './held-takeover'
import { quarantineOutcome } from './start-failure-record'
import { HeldEnding } from './held-ending'
import { HeldObservation } from './held-observation'
import { HeldActions } from './held-actions'
import { HeldDrain } from './held-drain'

export type { HeldSessionDeps }

export class HeldSession {
  readonly sessionId: string
  private readonly deps: HeldSessionDeps
  private readonly lifetimeAbort = new AbortController()
  private readonly pause = new PauseSignal()
  private readonly turns: HeldTurns
  private readonly prepare: HeldPrepare
  private readonly seed: ContextSeedGate
  private readonly actions: HeldActions
  private readonly drain: HeldDrain
  private draining = false
  private runtime: SessionRuntime | undefined
  private record: SessionRecord | undefined
  private observation: HeldObservation | undefined
  private crew: CrewRoom | undefined
  private reconciler: Reconciler | undefined
  private readonly fenced: FencedSettlement
  private readonly ending: HeldEnding
  runtimeOf(): SessionRuntime | undefined {
    return this.runtime
  }

  private settleFence = true
  private takeOver: TakeOver | undefined

  constructor(deps: HeldSessionDeps) {
    this.deps = deps
    this.sessionId = deps.sessionId
    this.turns = new HeldTurns(deps)
    this.seed = new ContextSeedGate({
      deps,
      runtime: () => this.runtime,
      record: () => this.record,
    })
    this.turns.onTurnEnd = () => {
      this.observation?.turnEnded()
      this.reconciler?.request()
    }
    this.prepare = new HeldPrepare({
      deps,
      seed: this.seed,
      abandoned: () => this.draining || this.ending.outcome !== undefined,
      onSettled: ({ failed }) => {
        if (failed && !this.prepare.resumed) this.ending.finish(EHeldOutcome.Idle)
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
    this.actions = new HeldActions({
      deps,
      turns: this.turns,
      prepare: this.prepare,
      seed: this.seed,
      ending: this.ending,
      pause: this.pause,
      draining: () => this.draining,
      runtime: () => this.runtime,
      record: () => this.record,
      observation: () => this.observation,
      childrenRunning: () => this.crew?.runningCount() ?? 0,
      takeOverFirstStep: () => this.takeOver?.firstStep(),
      request: () => this.reconciler?.request(),
    })
    this.drain = new HeldDrain({
      deps,
      sessionId: this.sessionId,
      turns: this.turns,
      ending: this.ending,
      record: () => this.record,
      runtime: () => this.runtime,
      childrenPause: () => this.crew?.pauseAll(),
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
    this.abortCallsWaitingOnTheWorkspace()
    this.reconciler?.request()
  }

  private abortCallsWaitingOnTheWorkspace(): void {
    if (!this.turns.turnRunning) return
    if (this.runtime?.workspaceGate?.blocked !== true) return
    this.turns.abort('handoff')
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
    await this.drain.handoff()
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
    const takeOver = new TakeOver(deps, args.claimMs ?? 0)
    this.takeOver = takeOver
    const { runtime, record } = await takeOver.open({
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
    const { runner, branches, oom, branchesStarted, recoverCommands, runCommands, logStaged } =
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
    this.observation = new HeldObservation({
      deps,
      runtime,
      record,
      branches,
      oom,
    })
    this.observation.start()
    this.actions.attach({
      logStaged,
      runCommands,
      retryChild: (agentId) => crew.retry({ agentId }),
    })
    await takeOver.lapped({
      lap: ETakeoverLap.Settle,
      work: () => settleAndCheckResume({ deps, runtime, record, threadId, crew }),
    })
    await takeOver.lapped({ lap: ETakeoverLap.Commands, work: recoverCommands })
    runtime.workspaceGate?.hold(branchesStarted)
    void branchesStarted.then(() => takeOver.branchesSettled())
    const completion = this.ending.waitForDrive()
    if (this.lifetimeAbort.signal.aborted || this.ending.outcome !== undefined) return
    const reconciler = new Reconciler({
      timers: deps.timers,
      step: () =>
        this.actions.step({
          runner,
          threadId,
          lap: (worked) => this.lapped(worked),
        }),
      onError: (error) => logReconcileFault({ deps, error }),
    })
    this.reconciler = reconciler
    reconciler.request()
    await completion
  }

  private async lapped<T>(args: { lap: ETakeoverLap; work: () => Promise<T> }): Promise<T> {
    const takeOver = this.takeOver
    return takeOver === undefined ? args.work() : takeOver.lapped(args)
  }

  losePresence(): void {
    this.settleFence = false
    this.ending.lose()
  }
}
