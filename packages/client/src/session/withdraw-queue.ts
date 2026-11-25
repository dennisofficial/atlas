import { EMessageOrigin, saidBy, type RecordEvent } from '@dltech/atlas-core'
import {
  EWithdrawRefusal,
  type SessionWithdrawInput,
  type SessionWithdrawOutput,
} from '@dltech/atlas-protocol'

import { ALREADY_SENT_REASON } from '../stream/outgoing-messages'

export const ALREADY_SENT_NOTICE = 'Already sent — the agent got it'

export const WITHDRAW_UNKNOWN_NOTICE = 'That message is no longer queued'

export type WithdrawTarget = { sessionId: string; targetInboxId: number }

export type WithdrawIntent = WithdrawTarget & { requestId: number }

export type WithdrawSettlement =
  | { targetInboxId: number; status: 'withdrawn' }
  | { targetInboxId: number; status: 'refused'; notice: string }

export type WithdrawApi = {
  withdraw(input: SessionWithdrawInput): Promise<SessionWithdrawOutput>
}

export type WithdrawIntentPort = {
  request: (target: WithdrawTarget) => WithdrawIntent | null
  holds: (intent: WithdrawIntent) => boolean
  discard: (intent: WithdrawIntent) => void
}

export type WithdrawRequestOutcome =
  | { kind: 'accepted' }
  | { kind: 'ignored' }
  | { kind: 'refused'; notice: string }
  | { kind: 'failed'; failure: unknown }

export type WithdrawRequest = {
  recorded: boolean
  outcome: Promise<WithdrawRequestOutcome>
}

export type SaidLike = {
  via?: EMessageOrigin | undefined
  sender?: { session: string } | undefined
}

export const operatorSaidOf = (said: SaidLike): boolean =>
  said.sender === undefined && saidBy(said) === EMessageOrigin.Operator

export const withdrawOwnedInboxIdsOf = (args: {
  events: readonly RecordEvent[]
  intents: readonly WithdrawIntent[]
}): ReadonlySet<number> => {
  const owned = new Set(args.intents.map((intent) => intent.targetInboxId))
  for (const event of args.events) {
    if (event.type === 'input-withdrawn') owned.add(event.inboxId)
    if (event.type === 'input-refused' && event.targetInboxId !== undefined) {
      owned.add(event.targetInboxId)
    }
  }
  return owned
}

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

const settleWithdraw = async (args: {
  api: WithdrawApi
  intents: WithdrawIntentPort
  intent: WithdrawIntent
}): Promise<WithdrawRequestOutcome> => {
  try {
    const result = await args.api.withdraw({
      sessionId: args.intent.sessionId,
      inboxId: args.intent.targetInboxId,
    })
    if (result.ok) return { kind: 'accepted' }
    if (!args.intents.holds(args.intent)) return { kind: 'ignored' }
    args.intents.discard(args.intent)
    return { kind: 'refused', notice: withdrawRefusalNoticeOf(result.reason) }
  } catch (failure) {
    if (!args.intents.holds(args.intent)) return { kind: 'ignored' }
    args.intents.discard(args.intent)
    return { kind: 'failed', failure }
  }
}

export const requestWithdraw = (args: {
  api: WithdrawApi
  intents: WithdrawIntentPort
  target: WithdrawTarget
}): WithdrawRequest => {
  const intent = args.intents.request(args.target)
  if (intent === null) {
    return { recorded: false, outcome: Promise.resolve({ kind: 'ignored' }) }
  }
  return {
    recorded: true,
    outcome: settleWithdraw({ api: args.api, intents: args.intents, intent }),
  }
}
