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

const kindsOf = (pending: readonly PendingWork[]): readonly EPendingWork[] => [
  ...new Set(pending.map((work) => work.kind)),
]

export const notifyDecisionOf = (args: {
  moment: ENotifyMoment
  pending: readonly PendingWork[]
  operatorTurn: boolean
}): NotifyDecision => {
  const pending = kindsOf(args.pending)
  const held = args.moment === ENotifyMoment.TurnFinished && pending.length > 0
  return {
    moment: args.moment,
    verdict: held ? ENotifyVerdict.Hold : ENotifyVerdict.Send,
    holdMs: held ? holdMsOf(pending) : 0,
    pending,
    operatorTurn: args.operatorTurn,
  }
}
