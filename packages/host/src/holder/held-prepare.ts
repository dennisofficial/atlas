import {
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  setupFinishedText,
  setupStartedText,
  setupInFlightOf,
  workspaceStepsOf,
  type EventDraft,
  type RunId,
  type ThreadId,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'
import { setupOutputCallId } from '@dltech/atlas-protocol'

import {
  appendAttemptStarted,
  appendSetupStep,
  elapsedMsOf,
  prepareAttemptOf,
  stoppedSetupDraftsOf,
} from './prepare-attempt'
import type { HeldSessionDeps } from './held-session-deps'
import { fireLive, type PrepareResult, type SessionRuntime, type SetupLifecycle } from './ports'
import { setupNoticesOf } from './prepare-notices'
import { recordPrepare } from './prepare-record'
import type { AppendBody } from './record/append-drafts'
import type { SessionRecord } from './record/record-adapter'

const appendFailureReporter =
  (deps: HeldSessionDeps, verb: string) =>
  (error: unknown): void =>
    deps.log?.error({
      source: 'holder.prepare',
      message: `${verb} of ${deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })

export class HeldPrepare {
  private active = false
  private setupRunning = false
  private resuming = false
  private joined = false
  private attempt: number | undefined
  private script: string | undefined
  private setupStartedAt = 0
  private startedText: string | undefined
  private finished: { text: string; failed: boolean } | undefined
  private target: { record: SessionRecord; threadId: ThreadId } | undefined
  private steps: Promise<void> = Promise.resolve()
  private settled = false

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      abandoned(): boolean
      onSettled(args: { failed: boolean }): void
      onSetupEnded(): void
    },
  ) {}

  get running(): boolean {
    return this.active
  }

  get hasSetupRunning(): boolean {
    return this.setupRunning
  }

  get resumed(): boolean {
    return this.resuming
  }

  start(args: {
    runtime: SessionRuntime
    record: SessionRecord
    threadId: ThreadId
    inboxHead: number
  }): void {
    // a setup left running by an earlier host is joined once, not on every reconciler step
    if (this.active || this.joined) return
    this.active = true
    this.settled = false
    this.startedText = undefined
    this.finished = undefined
    this.target = { record: args.record, threadId: args.threadId }
    const recorded = args.record.eventCache().eventsAfter(0)
    const setup = workspaceStepsOf(recorded)[EWorkspaceStep.Setup]
    this.resuming = setupInFlightOf(recorded)
    this.joined = this.resuming
    this.attempt = prepareAttemptOf({ events: recorded, resuming: this.resuming })
    this.script = setup?.command
    this.setupStartedAt = setup === undefined ? 0 : Date.parse(setup.at)
    this.setupRunning = this.resuming
    const { deps } = this.args
    const runId: RunId = deps.ids.nextRunId()
    let failed = false
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
    const onStep = (step: WorkspaceStepReport): void => {
      this.steps = this.steps.then(() => this.recordStep({ ...args, runId, step }))
    }
    args.runtime.subscribePrepareOutput?.((text) =>
      fireLive({
        bus: deps.bus,
        sessionId: deps.sessionId,
        frame: { type: 'tool-output', callId: setupOutputCallId(deps.sessionId), text },
      }),
    )
    args.runtime.subscribeSetup?.((lifecycle) => this.onSetup(lifecycle))
    void args.runtime
      .prepare(onStep)
      .catch((error): PrepareResult => {
        deps.log?.error({
          source: 'holder.prepare',
          message: `preparing ${deps.sessionId} threw`,
          ...logFieldsOf({ error }),
        })
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      })
      .then(async (result) => {
        await this.steps
        await this.record({ ...args, runId, result })
        this.settled = true
        await this.flushSetupEnd()
        failed = !result.ok
      })
      .catch((error) => {
        deps.log?.error({
          source: 'holder.prepare',
          message: `recording the preparation of ${deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      })
      .finally(() => {
        this.active = false
        this.args.onSettled({ failed })
      })
  }

  private onSetup(lifecycle: SetupLifecycle): void {
    if (this.args.abandoned()) return
    if (lifecycle.phase === ESetupPhase.Started) {
      this.script = lifecycle.script
      if (this.setupStartedAt === 0) this.setupStartedAt = this.args.deps.timers.now()
      const record = this.target?.record
      if (record === undefined || !setupNoticesOf(record).has(ESetupPhase.Started)) {
        this.startedText = setupStartedText({ script: lifecycle.script })
      }
      this.setupRunning = true
      return
    }
    this.joined = false
    this.finished = {
      text: setupFinishedText({
        script: lifecycle.script,
        ok: lifecycle.ok,
        durationMs: Math.max(lifecycle.durationMs, this.elapsedMs()),
        output: lifecycle.output,
      }),
      failed: !lifecycle.ok,
    }
    void this.flushSetupEnd()
  }

  async failStopped(): Promise<void> {
    const target = this.target
    if (target === undefined || !this.setupRunning) return
    const script = this.script ?? ''
    this.setupRunning = false
    this.joined = false
    this.finished = undefined
    await target.record
      .append({
        threadId: target.threadId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: stoppedSetupDraftsOf({
          script,
          attempt: this.attempt,
          durationMs: this.elapsedMs(),
        }),
      })
      .catch(appendFailureReporter(this.args.deps, 'recording the stop of the setup'))
  }

  private elapsedMs(): number {
    return elapsedMsOf({ startedAt: this.setupStartedAt, nowMs: this.args.deps.timers.now() })
  }

  private async flushSetupEnd(): Promise<void> {
    const { finished, target } = this
    if (finished === undefined || target === undefined || !this.settled) return
    this.finished = undefined
    await this.steps
    // a replayed lifecycle, or an end an earlier host already recorded, is reported once
    if (!this.args.abandoned() && !setupNoticesOf(target.record).has(ESetupPhase.Finished)) {
      await this.args.deps.plane
        .post({
          sessionId: this.args.deps.sessionId,
          kind: INBOX_KIND_EVENT,
          payload: inboxEventPayloadOf({
            event: {
              type: 'sandbox-setup-reported',
              text: finished.text,
              failed: finished.failed,
              phase: ESetupPhase.Finished,
            },
            clientId: `sandbox-setup-finished:${this.args.deps.sessionId}`,
          }),
        })
        .catch(appendFailureReporter(this.args.deps, 'recording the end of the setup'))
    }
    this.setupRunning = false
    this.args.onSetupEnded()
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
      started: setupNoticesOf(args.record).has(ESetupPhase.Started) ? [] : this.takeStarted(),
      lostSetup: result.ok ? [] : this.endLostSetup(result.reason),
    })
  }

  private endLostSetup(reason: string): AppendBody[] {
    this.joined = false
    if (!this.setupRunning) return []
    this.setupRunning = false
    return [
      {
        type: 'workspace-step',
        step: EWorkspaceStep.Setup,
        state: EWorkspaceStepState.Interrupted,
        reason: `the setup was lost when the workspace could not be prepared again: ${reason}`,
        ...(this.script === undefined ? {} : { command: this.script }),
        ...(this.attempt === undefined ? {} : { attempt: this.attempt }),
      },
    ]
  }

  private takeStarted(): EventDraft[] {
    const text = this.startedText
    if (text === undefined) return []
    this.startedText = undefined
    return [{ type: 'sandbox-setup-reported', text, failed: false, phase: ESetupPhase.Started }]
  }
}
