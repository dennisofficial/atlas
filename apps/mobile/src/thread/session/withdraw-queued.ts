import { pendingMessagesOf, type Attachment, type PendingInputsState } from '@dltech/atlas-core'
import type { WithdrawIntent, WithdrawSettlement } from '@dltech/atlas-client/session'

export type QueuedRestore = { text: string; attachments: readonly Attachment[] }

export type QueuedWithdrawPlan = {
  intent: WithdrawIntent
  restore: QueuedRestore | undefined
}

export const queuedWithdrawPlanOf = (args: {
  sessionId: string
  pending: PendingInputsState
  inboxId: number
  restoreText: boolean
}): QueuedWithdrawPlan | undefined => {
  const entry = pendingMessagesOf(args.pending).find((input) => input.inboxId === args.inboxId)
  if (entry === undefined) return undefined
  const intent: WithdrawIntent = { sessionId: args.sessionId, targetInboxId: args.inboxId }
  if (!args.restoreText) return { intent, restore: undefined }
  return {
    intent,
    restore: {
      text: entry.message?.text ?? '',
      attachments: entry.message?.attachments ?? [],
    },
  }
}

export const withdrawalNoticesOf = (
  settlements: readonly WithdrawSettlement[],
): readonly string[] =>
  settlements.flatMap((entry) => (entry.status === 'refused' ? [entry.notice] : []))
