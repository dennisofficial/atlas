import type { InboxEntry, ThreadId } from '@dltech/atlas-core'
import { INBOX_KIND_REPAIR_DIAGRAM } from '@dltech/atlas-protocol'
import { logFieldsOf } from '@dltech/atlas-observability'

import { repairDiagram } from './diagram-repair'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export class HeldRepairs {
  private readonly attempted = new Set<number>()
  private active = 0

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      signal: AbortSignal
      onChange(): void
    },
  ) {}

  get running(): boolean {
    return this.active > 0
  }

  start(args: {
    entries: readonly InboxEntry[]
    runtime: SessionRuntime | undefined
    record: SessionRecord | undefined
    threadId: ThreadId
  }): void {
    const { deps, signal } = this.args
    const { runtime, record } = args
    if (runtime === undefined || record === undefined) return
    for (const entry of args.entries) {
      if (entry.kind !== INBOX_KIND_REPAIR_DIAGRAM || this.attempted.has(entry.inboxId)) continue
      this.attempted.add(entry.inboxId)
      this.active += 1
      this.args.onChange()
      void repairDiagram({
        model: runtime.model,
        entry,
        record,
        threadId: args.threadId,
        runId: deps.ids.nextRunId(),
        signal,
        log: deps.log,
      })
        .catch((error) => {
          deps.log?.error({
            source: 'holder.diagram-repair',
            message: `recording the repair for inbox entry ${entry.inboxId} failed`,
            ...logFieldsOf({ error }),
          })
        })
        .finally(() => {
          this.active -= 1
          this.args.onChange()
        })
    }
  }
}
