import { EMessageOrigin, saidBy } from '../events/body'
import type { V2Event } from '../record/event'

const isTurnEnded = (event: V2Event): boolean => event.type === 'turn-ended'

const isOperatorSaid = (event: V2Event): boolean =>
  event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator

export const operatorTurnOf = (args: { events: readonly V2Event[] }): boolean => {
  const lastEnd = args.events.findLastIndex(isTurnEnded)
  const previousEnd = lastEnd === -1 ? -1 : args.events.slice(0, lastEnd).findLastIndex(isTurnEnded)
  return args.events.slice(previousEnd + 1).some(isOperatorSaid)
}
