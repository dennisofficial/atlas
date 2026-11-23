import { ENotifyMoment } from './moment'
import { holdMsOf, type EPendingWork, type PendingWork } from './pending-work'

export enum ENotifyVerdict {
  Send = 'send',
  Hold = 'hold',
}

export type NotifyDecision = {
  moment: ENotifyMoment
  verdict: ENotifyVerdict
  holdMs: number
  pending: readonly EPendingWork[]
  operatorTurn: boolean
}

const uniqueKinds = (kinds: readonly EPendingWork[]): readonly EPendingWork[] => [...new Set(kinds)]

const kindsOf = (pending: readonly PendingWork[]): readonly EPendingWork[] =>
  uniqueKinds(pending.map((work) => work.kind))

export const notifyDecisionOfKinds = (args: {
  moment: ENotifyMoment
  pending: readonly EPendingWork[]
  operatorTurn: boolean
}): NotifyDecision => {
  const pending = uniqueKinds(args.pending)
  const held = args.moment === ENotifyMoment.TurnFinished && pending.length > 0
  return {
    moment: args.moment,
    verdict: held ? ENotifyVerdict.Hold : ENotifyVerdict.Send,
    holdMs: held ? holdMsOf(pending) : 0,
    pending,
    operatorTurn: args.operatorTurn,
  }
}

export const notifyDecisionOf = (args: {
  moment: ENotifyMoment
  pending: readonly PendingWork[]
  operatorTurn: boolean
}): NotifyDecision =>
  notifyDecisionOfKinds({
    moment: args.moment,
    pending: kindsOf(args.pending),
    operatorTurn: args.operatorTurn,
  })
