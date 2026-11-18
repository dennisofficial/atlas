import { INBOX_KIND_WITHDRAW, withdrawPayloadOf } from '@dltech/atlas-control'
import type { InboxEntry, RecordBody } from '@dltech/atlas-core'

import type { AppendDrafts } from './staged-log'

export type WithdrawPlan = { drafts: RecordBody[]; withdrawn?: number | undefined }

export type WithdrawLookup = {
  stagedOf: (inboxId: number) => InboxEntry | undefined
  postedInboxIds: () => ReadonlySet<number>
  postedDraftsOf: (entry: InboxEntry) => RecordBody[]
}

export const withdrawPlanOf = (params: {
  entry: InboxEntry
  lookup: WithdrawLookup
}): WithdrawPlan => {
  const { entry, lookup } = params
  const payload = withdrawPayloadOf(entry.payload)
  if (payload === undefined) {
    return {
      drafts: [{ type: 'input-refused', inboxId: entry.inboxId, reason: 'unreadable withdraw' }],
    }
  }
  const pending = lookup.postedInboxIds()
  const staged = lookup.stagedOf(payload.targetInboxId)
  if (staged !== undefined && staged.consumedSeq === null && !pending.has(staged.inboxId)) {
    return {
      drafts: [
        ...lookup.postedDraftsOf(staged),
        { type: 'input-withdrawn', inboxId: staged.inboxId, requestInboxId: entry.inboxId },
      ],
      withdrawn: staged.inboxId,
    }
  }
  if (pending.has(payload.targetInboxId)) {
    return {
      drafts: [
        {
          type: 'input-withdrawn',
          inboxId: payload.targetInboxId,
          requestInboxId: entry.inboxId,
        },
      ],
      withdrawn: payload.targetInboxId,
    }
  }
  return {
    drafts: [
      {
        type: 'input-refused',
        inboxId: entry.inboxId,
        targetInboxId: payload.targetInboxId,
        reason: 'already-sent',
      },
    ],
  }
}

export const resolveWithdraws = async (params: {
  entries: readonly InboxEntry[]
  lookup: WithdrawLookup
  appendDrafts: AppendDrafts
}): Promise<ReadonlySet<number>> => {
  const resolved = new Set<number>()
  for (const entry of params.entries) {
    if (entry.kind !== INBOX_KIND_WITHDRAW) continue
    resolved.add(entry.inboxId)
    const plan = withdrawPlanOf({ entry, lookup: params.lookup })
    if (plan.withdrawn !== undefined) resolved.add(plan.withdrawn)
    await params.appendDrafts(plan.drafts)
  }
  return resolved
}
