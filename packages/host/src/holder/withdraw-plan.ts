import { INBOX_KIND_WITHDRAW, withdrawPayloadOf } from '@dltech/atlas-control'
import {
  EMessageOrigin,
  isMessageInputKind,
  saidBy,
  type InboxEntry,
  type PendingInput,
  type RecordBody,
} from '@dltech/atlas-core'

import { inboxMessageSchema } from '@dltech/atlas-protocol'

import { jsonOf, type AppendDrafts } from './staged-log'

export type WithdrawPlan = { drafts: RecordBody[]; withdrawn?: number | undefined }

export type WithdrawLookup = {
  stagedOf: (inboxId: number) => InboxEntry | undefined
  pendingOf: (inboxId: number) => PendingInput | undefined
  postedDraftsOf: (entry: InboxEntry) => RecordBody[]
}

const isOperatorStaged = (staged: InboxEntry): boolean => {
  if (staged.senderSessionId !== null) return false
  const message = inboxMessageSchema.safeParse(jsonOf(staged.payload))
  return !message.success || saidBy(message.data) === EMessageOrigin.Operator
}

const isOperatorMessage = (params: {
  staged: InboxEntry | undefined
  pending: PendingInput | undefined
}): boolean => {
  if (params.pending?.message !== undefined)
    return (
      params.pending.message.sender === undefined &&
      saidBy(params.pending.message) === EMessageOrigin.Operator
    )
  return params.staged === undefined || isOperatorStaged(params.staged)
}

const refusedOf = (params: {
  entry: InboxEntry
  targetInboxId: number
  reason: string
}): WithdrawPlan => ({
  drafts: [
    {
      type: 'input-refused',
      inboxId: params.entry.inboxId,
      targetInboxId: params.targetInboxId,
      reason: params.reason,
    },
  ],
})

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
  const staged = lookup.stagedOf(payload.targetInboxId)
  const pending = lookup.pendingOf(payload.targetInboxId)
  const kind = staged?.kind ?? pending?.kind
  if (kind !== undefined && !isMessageInputKind(kind)) {
    return refusedOf({
      entry,
      targetInboxId: payload.targetInboxId,
      reason: 'only a message can be withdrawn',
    })
  }
  if (!isOperatorMessage({ staged, pending })) {
    return refusedOf({
      entry,
      targetInboxId: payload.targetInboxId,
      reason: 'only an operator message can be withdrawn',
    })
  }
  if (staged !== undefined && staged.consumedSeq === null && pending === undefined) {
    return {
      drafts: [
        ...lookup.postedDraftsOf(staged),
        { type: 'input-withdrawn', inboxId: staged.inboxId, requestInboxId: entry.inboxId },
      ],
      withdrawn: staged.inboxId,
    }
  }
  if (pending !== undefined) {
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
