import { withdrawRefusalNoticeOf } from '@dltech/atlas-client/session'
import type { SessionWithdrawInput, SessionWithdrawOutput } from '@dltech/atlas-protocol'

export type WithdrawApi = {
  withdraw(input: SessionWithdrawInput): Promise<SessionWithdrawOutput>
}

export enum EWithdrawOutcome {
  Queued = 'queued',
  Refused = 'refused',
}

export type WithdrawResult =
  | { outcome: EWithdrawOutcome.Queued }
  | { outcome: EWithdrawOutcome.Refused; notice: string }

export const requestWithdraw = async (args: {
  api: WithdrawApi
  sessionId: string
  inboxId: number
}): Promise<WithdrawResult> => {
  const result = await args.api.withdraw({ sessionId: args.sessionId, inboxId: args.inboxId })
  if (result.ok) return { outcome: EWithdrawOutcome.Queued }
  return { outcome: EWithdrawOutcome.Refused, notice: withdrawRefusalNoticeOf(result.reason) }
}
