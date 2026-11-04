import type { RunId, ThreadId } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import { statusFrame, type PrepareResult, type SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export class HeldPrepare {
  private active = false

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      abandoned(): boolean
      onSettled(): void
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
    deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state: 'preparing' }) })
    void args.runtime
      .prepare()
      .catch((error): PrepareResult => {
        deps.log?.error({
          source: 'holder.prepare',
          message: `preparing ${deps.sessionId} threw`,
          ...logFieldsOf({ error }),
        })
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      })
      .then((result) => this.record({ ...args, result }))
      .catch((error) => {
        deps.log?.error({
          source: 'holder.prepare',
          message: `recording the preparation of ${deps.sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      })
      .finally(() => {
        this.active = false
        this.args.onSettled()
      })
  }

  private async record(args: {
    record: SessionRecord
    threadId: ThreadId
    inboxHead: number
    result: PrepareResult
  }): Promise<void> {
    if (this.args.abandoned()) return
    const { deps } = this.args
    const { result } = args
    const runId: RunId = deps.ids.nextRunId()
    const body = result.ok
      ? ({ type: 'workspace-prepared' } as const)
      : ({
          type: 'workspace-prepare-failed',
          reason: result.reason,
          inboxHead: args.inboxHead,
        } as const)
    await args.record.append({ threadId: args.threadId, runId, drafts: [body] })
    const state = result.ok ? 'idle' : 'setup-failed'
    deps.bus.live({ sessionId: deps.sessionId, frame: statusFrame({ state }) })
  }
}
