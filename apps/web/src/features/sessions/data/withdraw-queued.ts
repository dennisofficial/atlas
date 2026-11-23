import type { SessionWithdrawInput, SessionWithdrawOutput } from '@dltech/atlas-protocol'
import { EWithdrawRefusal } from '@dltech/atlas-protocol'
import type { Attachment } from '@dltech/atlas-core'

import { mergeWithdrawnIntoDraft } from './queued-messages'

export const ALREADY_SENT_NOTICE = 'Already sent'
export const WITHDRAW_UNKNOWN_NOTICE = 'That message is no longer queued'

export type WithdrawApi = {
  withdraw(input: SessionWithdrawInput): Promise<SessionWithdrawOutput>
}

export enum EWithdrawOutcome {
  Withdrawn = 'withdrawn',
  Refused = 'refused',
}

export type WithdrawResult =
  | { outcome: EWithdrawOutcome.Withdrawn; draft: string; attachments: readonly Attachment[] }
  | { outcome: EWithdrawOutcome.Refused; notice: string }

export const withdrawQueued = async (args: {
  api: WithdrawApi
  sessionId: string
  inboxId: number
  text: string
  attachments: readonly Attachment[]
  draft: string
  restoreText: boolean
}): Promise<WithdrawResult> => {
  const result = await args.api.withdraw({ sessionId: args.sessionId, inboxId: args.inboxId })
  if (!result.ok) {
    return {
      outcome: EWithdrawOutcome.Refused,
      notice:
        result.reason === EWithdrawRefusal.AlreadyConsumed
          ? ALREADY_SENT_NOTICE
          : WITHDRAW_UNKNOWN_NOTICE,
    }
  }
  if (!args.restoreText) {
    return { outcome: EWithdrawOutcome.Withdrawn, draft: args.draft, attachments: [] }
  }
  return {
    outcome: EWithdrawOutcome.Withdrawn,
    draft: mergeWithdrawnIntoDraft({ withdrawn: args.text, draft: args.draft }),
    attachments: args.attachments,
  }
}
