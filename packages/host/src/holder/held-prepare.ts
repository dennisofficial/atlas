import {
  ESetupPhase,
  setupFinishedText,
  setupStartedText,
  type EventDraft,
  type RunId,
  type ThreadId,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'
import { setupOutputCallId } from '@dltech/atlas-protocol'

import type { HeldSessionDeps } from './held-session-deps'
import { fireLive, type PrepareResult, type SessionRuntime, type SetupLifecycle } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { setupWarningText } from './setup-warning'

export class HeldPrepare {
  private active = false
  private setupRunning = false
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
    if (this.active) return
    this.active = true
    this.settled = false
    this.startedText = undefined
    this.finished = undefined
    this.setupRunning = false
    this.target = { record: args.record, threadId: args.threadId }
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
      this.startedText = setupStartedText({ script: lifecycle.script })
      this.setupRunning = true
      return
    }
    this.setupRunning = false
    this.finished = {
      text: setupFinishedText({
        script: lifecycle.script,
        ok: lifecycle.ok,
        durationMs: lifecycle.durationMs,
        output: lifecycle.output,
      }),
      failed: !lifecycle.ok,
    }
    void this.flushSetupEnd()
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
    await args.record.append({
      threadId: args.threadId,
      runId,
      drafts: [
        ...started,
        ...(warnings.length === 0
          ? [{ type: 'workspace-prepared' } as const]
          : [
              {
                type: 'sandbox-setup-reported' as const,
                text: setupWarningText(warnings),
                failed: true,
              },
              { type: 'workspace-prepared' as const, warnings: [...warnings] },
            ]),
      ],
    })
  }

  private takeStarted(): EventDraft[] {
    const text = this.startedText
    if (text === undefined) return []
    this.startedText = undefined
    return [{ type: 'sandbox-setup-reported', text, failed: false, phase: ESetupPhase.Started }]
  }
}
