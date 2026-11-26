import {
  ESetupPhase,
  EWorkspaceStep,
  preparedBeforeOf,
  setupInFlightOf,
  workspaceStepsOf,
  type RunId,
  type ThreadId,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import { EPreparePhase, logFieldsOf } from '@dltech/atlas-observability'
import { setupOutputCallId } from '@dltech/atlas-protocol'

import { appendAttemptStarted, appendSetupStep, prepareAttemptOf } from './prepare-attempt'
import type { HeldSessionDeps } from './held-session-deps'
import {
  fireLive,
  type PrepareResult,
  type PrepareStepReporter,
  type SessionRuntime,
} from './ports'
import { PrepareSpan } from './prepare-span'
import { PrepareSetup } from './prepare-setup'
import { setupNoticesOf } from './prepare-notices'
import { recordPrepare } from './prepare-record'
import { preparedWithContextFiles, type ContextSeedGate } from './context-seed'
import type { SessionRecord } from './record/record-adapter'

const appendFailureReporter =
  (deps: HeldSessionDeps, verb: string) =>
  (error: unknown): void =>
    deps.log?.error({
      source: 'holder.prepare',
      message: `${verb} of ${deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })

type PrepareStart = {
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  inboxHead: number
  promptWaiting?: boolean | undefined
}

export class HeldPrepare {
  private active = false
  private resuming = false
  private attempt: number | undefined
  private target: { record: SessionRecord; threadId: ThreadId } | undefined
  private steps: Promise<void> = Promise.resolve()
  private settled = false
  private span: PrepareSpan | undefined
  private readonly setup: PrepareSetup

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      seed: ContextSeedGate
      abandoned(): boolean
      onSettled(args: { failed: boolean }): void
      onSetupEnded(): void
    },
  ) {
    this.setup = new PrepareSetup({
      deps: args.deps,
      abandoned: () => args.abandoned(),
      settled: () => this.settled,
      steps: () => this.steps,
      attempt: () => this.attempt,
      target: () => this.target,
      onEnded: () => args.onSetupEnded(),
    })
  }

  get running(): boolean {
    return this.active
  }

  get hasSetupRunning(): boolean {
    return this.setup.isRunning
  }

  get resumed(): boolean {
    return this.resuming
  }

  start(args: PrepareStart): void {
    // a setup left running by an earlier host is joined once, not on every reconciler step
    if (this.active || this.setup.isJoined) return
    this.active = true
    this.settled = false
    this.target = { record: args.record, threadId: args.threadId }
    const recorded = args.record.eventCache().eventsAfter(0)
    const setup = workspaceStepsOf(recorded)[EWorkspaceStep.Setup]
    this.resuming = setupInFlightOf(recorded)
    this.attempt = prepareAttemptOf({ events: recorded, resuming: this.resuming })
    this.setup.start({
      script: setup?.command,
      since: setup === undefined ? 0 : Date.parse(setup.at),
      resuming: this.resuming,
    })
    const { deps } = this.args
    const runId: RunId = deps.ids.nextRunId()
    this.steps =
      this.attempt === undefined || this.resuming
        ? Promise.resolve()
        : appendAttemptStarted({
            record: args.record,
            threadId: args.threadId,
            runId,
            attempt: this.attempt,
            abandoned: () => this.args.abandoned(),
          }).catch(
            appendFailureReporter(this.args.deps, 'recording the start of a prepare attempt'),
          )
    const onStep = (step: WorkspaceStepReport, producedAtMs?: number): void => {
      this.span?.step(step, producedAtMs)
      this.steps = this.steps.then(() => this.recordStep({ ...args, runId, step }))
    }
    args.runtime.subscribePrepareOutput?.((text) =>
      fireLive({
        bus: deps.bus,
        key: deps.sessionId,
        frame: { type: 'tool-output', callId: setupOutputCallId(deps.sessionId), text },
      }),
    )
    args.runtime.subscribeSetup?.((lifecycle) => this.setup.onLifecycle(lifecycle))
    this.span = new PrepareSpan({
      trace: args.runtime.trace,
      sessionId: deps.sessionId,
      threadId: args.threadId,
      attempt: this.attempt,
      preparedBefore: preparedBeforeOf(recorded),
      promptWaiting: args.promptWaiting,
      now: () => deps.timers.now(),
    })
    void this.span
      .begin(() => this.attemptOf({ start: args, runId, onStep }))
      .catch((error: unknown): { failed: boolean } => {
        deps.log?.error({
          source: 'holder.prepare',
          message: `recording the preparation of ${deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
        return { failed: false }
      })
      .then(({ failed }) => {
        this.active = false
        this.args.onSettled({ failed })
      })
  }

  private async attemptOf(args: {
    start: PrepareStart
    runId: RunId
    onStep: PrepareStepReporter
  }): Promise<{ failed: boolean }> {
    const { deps } = this.args
    const { start, runId } = args
    const result = await start.runtime.prepare(args.onStep).catch((error): PrepareResult => {
      deps.log?.error({
        source: 'holder.prepare',
        message: `preparing ${deps.sessionId} threw`,
        ...logFieldsOf({ error }),
      })
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    })
    try {
      await this.timed(EPreparePhase.Steps, () => this.steps)
      const recorded = await this.timed(EPreparePhase.Seed, () =>
        preparedWithContextFiles({
          seed: this.args.seed,
          result,
          log: deps.log,
          sessionId: deps.sessionId,
        }),
      )
      await this.timed(EPreparePhase.Record, () =>
        this.record({ ...start, runId, result: recorded }),
      )
      this.settled = true
      await this.timed(EPreparePhase.SetupEnd, () => this.setup.flushEnd())
      return { failed: !recorded.ok }
    } catch (error) {
      deps.log?.error({
        source: 'holder.prepare',
        message: `recording the preparation of ${deps.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
      return { failed: false }
    }
  }

  private async timed<T>(name: EPreparePhase, work: () => Promise<T>): Promise<T> {
    const stop = this.span?.phase(name)
    try {
      return await work()
    } finally {
      stop?.()
    }
  }

  async failStopped(): Promise<void> {
    if (!this.setup.isRunning) return
    this.span?.markStopped()
    await this.setup.failStopped()
  }

  private async recordStep(args: {
    record: SessionRecord
    threadId: ThreadId
    runId: RunId
    step: WorkspaceStepReport
  }): Promise<void> {
    await appendSetupStep({
      ...args,
      attempt: this.attempt,
      abandoned: () => this.args.abandoned(),
    }).catch(appendFailureReporter(this.args.deps, 'recording a prepare step'))
  }

  private async record(args: {
    record: SessionRecord
    threadId: ThreadId
    runId: RunId
    inboxHead: number
    result: PrepareResult
  }): Promise<void> {
    if (this.args.abandoned()) return
    const { result } = args
    await recordPrepare({
      record: args.record,
      threadId: args.threadId,
      runId: args.runId,
      inboxHead: args.inboxHead,
      result,
      attempt: this.attempt,
      resuming: this.resuming,
      started: setupNoticesOf(args.record).has(ESetupPhase.Started) ? [] : this.setup.takeStarted(),
      lostSetup: result.ok ? [] : this.setup.endLostSetup(result.reason),
    })
  }
}
