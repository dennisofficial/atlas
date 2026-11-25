import type { RecordEvent } from '@dltech/atlas-core'
import {
  EWithdrawRefusal,
  type SessionWithdrawInput,
  type SessionWithdrawOutput,
} from '@dltech/atlas-protocol'

import { ALREADY_SENT_REASON } from '../stream/outgoing-messages'

export const ALREADY_SENT_NOTICE = 'Already sent — the agent got it'

export const WITHDRAW_UNKNOWN_NOTICE = 'That message is no longer queued'

export type WithdrawIntent = { sessionId: string; targetInboxId: number }

export type WithdrawSettlement =
  | { targetInboxId: number; status: 'withdrawn' }
  | { targetInboxId: number; status: 'refused'; notice: string }

export type WithdrawApi = {
  withdraw(input: SessionWithdrawInput): Promise<SessionWithdrawOutput>
}

export type WithdrawRequestOutcome = { accepted: true } | { accepted: false; notice: string }

export const withdrawRefusalNoticeOf = (reason: string): string =>
  reason === ALREADY_SENT_REASON || reason === EWithdrawRefusal.AlreadyConsumed
    ? ALREADY_SENT_NOTICE
    : WITHDRAW_UNKNOWN_NOTICE

const withdrawnIdsOf = (events: readonly RecordEvent[]): ReadonlySet<number> => {
  const ids = new Set<number>()
  for (const event of events) {
    if (event.type === 'input-withdrawn') ids.add(event.inboxId)
  }
  return ids
}

const refusedReasonsOf = (events: readonly RecordEvent[]): ReadonlyMap<number, string> => {
  const reasons = new Map<number, string>()
  for (const event of events) {
    if (event.type !== 'input-refused') continue
    const target = event.targetInboxId ?? event.inboxId
    if (reasons.has(target)) continue
    reasons.set(target, event.reason)
  }
  return reasons
}

export const withdrawSettlementsOf = (args: {
  intents: readonly WithdrawIntent[]
  events: readonly RecordEvent[]
}): readonly WithdrawSettlement[] => {
  if (args.intents.length === 0) return []
  const withdrawn = withdrawnIdsOf(args.events)
  const refused = refusedReasonsOf(args.events)
  return args.intents.flatMap((intent): readonly WithdrawSettlement[] => {
    if (withdrawn.has(intent.targetInboxId)) {
      return [{ targetInboxId: intent.targetInboxId, status: 'withdrawn' }]
    }
    const reason = refused.get(intent.targetInboxId)
    if (reason === undefined) return []
    return [
      {
        targetInboxId: intent.targetInboxId,
        status: 'refused',
        notice: withdrawRefusalNoticeOf(reason),
      },
    ]
  })
}

export const requestWithdraw = async (args: {
  api: WithdrawApi
  sessionId: string
  targetInboxId: number
}): Promise<WithdrawRequestOutcome> => {
  const result = await args.api.withdraw({
    sessionId: args.sessionId,
    inboxId: args.targetInboxId,
  })
  if (result.ok) return { accepted: true }
  return { accepted: false, notice: withdrawRefusalNoticeOf(result.reason) }
}
