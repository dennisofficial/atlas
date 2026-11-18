import {
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
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

import { baseFactDraftsOf } from './held-prepare-bases'
import type { HeldSessionDeps } from './held-session-deps'
import { fireLive, type PrepareResult, type SessionRuntime, type SetupLifecycle } from './ports'
import type { AppendBody } from './record/append-drafts'
import type { SessionRecord } from './record/record-adapter'
import { setupWarningText } from './setup-warning'

const SETUP_STOPPED_REASON = 'setup was stopped with the session'

export class HeldPrepare {
  private active = false
  private setupRunning = false
  private resuming = false
  private joined = false
  private script: string | undefined
  private setupStartedAt: number | undefined
  private startedText: string | undefined
  private finished: { text: string; failed: boolean } | undefined
  private target: { record: SessionRecord; threadId: ThreadId } | undefined
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
    this.script = setup?.command
    this.setupStartedAt = setup === undefined ? undefined : Date.parse(setup.at)
    this.setupRunning = this.resuming
    const { deps } = this.args
    const runId: RunId = deps.ids.nextRunId()
    let failed = false
    let steps: Promise<void> = Promise.resolve()
    const onStep = (step: WorkspaceStepReport): void => {
      steps = steps.then(() => this.recordStep({ ...args, runId, step }))
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
        await steps
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
      if (!this.resuming) this.startedText = setupStartedText({ script: lifecycle.script })
      this.setupRunning = true
      return
    }
    this.setupRunning = false
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

  /**
   * The session was stopped (or archived) while the setup script was still running on the pod:
   * nothing will report its end now, so the record has to say that it did not finish.
   */
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
        drafts: [
          {
            type: 'workspace-step',
            step: EWorkspaceStep.Setup,
            state: EWorkspaceStepState.Failed,
            reason: SETUP_STOPPED_REASON,
            ...(script === '' ? {} : { command: script }),
          },
          {
            type: 'sandbox-setup-reported',
            text: setupFinishedText({
              script,
              ok: false,
              durationMs: this.elapsedMs(),
              output: '',
            }),
            failed: true,
            phase: ESetupPhase.Finished,
          },
        ],
      })
      .catch((error) => {
        this.args.deps.log?.error({
          source: 'holder.prepare',
          message: `recording the stop of the setup of ${this.args.deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      })
  }

  private elapsedMs(): number {
    const since = this.setupStartedAt
    return since === undefined ? 0 : Math.max(0, this.args.deps.timers.now() - since)
  }

  private async flushSetupEnd(): Promise<void> {
    const finished = this.finished
    const target = this.target
    if (finished === undefined || target === undefined || !this.settled) return
    if (this.args.abandoned()) return
    this.finished = undefined
    await target.record
      .append({
        threadId: target.threadId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: [
          {
            type: 'sandbox-setup-reported',
            text: finished.text,
            failed: finished.failed,
            phase: ESetupPhase.Finished,
          },
        ],
      })
      .catch((error) => {
        this.args.deps.log?.error({
          source: 'holder.prepare',
          message: `recording the end of the setup of ${this.args.deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
        return
      })
    this.args.onSetupEnded()
  }

  private async recordStep(args: {
    record: SessionRecord
    threadId: ThreadId
    runId: RunId
    step: WorkspaceStepReport
  }): Promise<void> {
    if (this.args.abandoned()) return
    await args.record
      .append({
        threadId: args.threadId,
        runId: args.runId,
        drafts: [{ type: 'workspace-step', ...args.step }],
      })
      .catch((error) => {
        this.args.deps.log?.error({
          source: 'holder.prepare',
          message: `recording a prepare step of ${this.args.deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      })
  }

  private async record(args: {
    record: SessionRecord
    threadId: ThreadId
    runId: RunId
    inboxHead: number
    result: PrepareResult
  }): Promise<void> {
    if (this.args.abandoned()) return
    const { result, runId } = args
    const started = this.takeStarted()
    if (!result.ok) {
      await args.record.append({
        threadId: args.threadId,
        runId,
        drafts: [
          { type: 'workspace-prepare-failed', reason: result.reason, inboxHead: args.inboxHead },
        ],
      })
      return
    }
    const warnings = result.warnings ?? []
    const drafts: AppendBody[] = [...started, ...baseFactDraftsOf(result.bases)]
    if (warnings.length > 0) {
      drafts.push({
        type: 'sandbox-setup-reported',
        text: setupWarningText(warnings),
        failed: true,
      })
    }
    // a resumed prepare of an already prepared workspace has its own notice to report, and must
    // not claim the workspace was prepared a second time
    if (!this.resuming) {
      drafts.push(
        warnings.length === 0
          ? { type: 'workspace-prepared' }
          : { type: 'workspace-prepared', warnings: [...warnings] },
      )
    }
    if (drafts.length === 0) return
    await args.record.append({ threadId: args.threadId, runId, drafts })
  }

  private takeStarted(): EventDraft[] {
    const text = this.startedText
    if (text === undefined) return []
    this.startedText = undefined
    return [{ type: 'sandbox-setup-reported', text, failed: false, phase: ESetupPhase.Started }]
  }
}
