import { EInputConsumed, type InboxEntry } from '@dltech/atlas-core'

import { logPendingMessageIdsOf } from './held-inbox'
import { INBOX_KIND_STOP } from './inbox-intake'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'

const isStopEntry = (entry: InboxEntry): boolean => entry.kind === INBOX_KIND_STOP

export const consumeStops = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  entries: readonly InboxEntry[]
}): Promise<void> => {
  const { deps, record } = args
  if (record === undefined) return
  const consume = async (params: { inboxId: number; consumed: EInputConsumed }): Promise<void> => {
    await record.append({
      threadId: record.threadId,
      runId: deps.ids.nextRunId(),
      drafts: [{ type: 'input-consumed', inboxId: params.inboxId, consumed: params.consumed }],
    })
  }
  const prepared = record.eventCache().bookkeeping().workspace().prepared
  const stopHead = Math.max(0, ...args.entries.filter(isStopEntry).map((entry) => entry.inboxId))
  const logged = prepared ? [] : logPendingMessageIdsOf(record.eventCache().eventsAfter(0))
  for (const entry of args.entries) {
    const covered = !prepared && entry.inboxId < stopHead
    if (entry.kind === INBOX_KIND_STOP) {
      await consume({ inboxId: entry.inboxId, consumed: EInputConsumed.Stop })
    } else if (covered) {
      await consume({ inboxId: entry.inboxId, consumed: EInputConsumed.Discarded })
    }
  }
  for (const inboxId of logged.filter((id) => id < stopHead)) {
    await consume({ inboxId, consumed: EInputConsumed.Discarded })
  }
}
