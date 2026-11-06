import type { RunId, ThreadId, WorkspaceStepReport } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'
import { setupOutputCallId } from '@dltech/atlas-protocol'

import type { HeldSessionDeps } from './held-session-deps'
import { fireLive, type PrepareResult, type SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export class HeldPrepare {
  private active = false

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      abandoned(): boolean
      onSettled(args: { failed: boolean }): void
    },
  ) {}

  get running(): boolean {
    return this.active
  }

  start(args: {
    runtime: SessionRuntime
    record: SessionRecord
    threadId: ThreadId
    inboxHead: number
  }): void {
    if (this.active) return
    this.active = true
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
    const body = result.ok
      ? ({ type: 'workspace-prepared' } as const)
      : ({
          type: 'workspace-prepare-failed',
          reason: result.reason,
          inboxHead: args.inboxHead,
        } as const)
    await args.record.append({ threadId: args.threadId, runId, drafts: [body] })
  }
}
