import type { InboxEntry } from '@dltech/atlas-core'

import { INBOX_KIND_STOP } from './inbox-intake'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'

export const consumeStops = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  entries: readonly InboxEntry[]
  onActivity(): void
}): Promise<void> => {
  const { deps, record } = args
  if (record === undefined) return
  for (const entry of args.entries) {
    if (entry.kind !== INBOX_KIND_STOP) continue
    args.onActivity()
    await record.append({
      threadId: record.threadId,
      runId: deps.ids.nextRunId(),
      drafts: [{ type: 'input-consumed', inboxId: entry.inboxId }],
    })
  }
}

export const raceDeadline = (args: {
  deps: HeldSessionDeps
  done: Promise<void>
  deadlineMs: number
}): Promise<'done' | 'late'> => {
  const late = new Promise<'late'>((resolve) => {
    const timer = args.deps.timers.setTimeout(() => resolve('late'), args.deadlineMs)
    void args.done.then(
      () => args.deps.timers.clearTimeout(timer),
      () => args.deps.timers.clearTimeout(timer),
    )
  })
  return Promise.race([args.done.then(() => 'done' as const), late])
}
