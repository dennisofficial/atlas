import { EMessageOrigin, saidBy } from '../events/body'
import type { RecordEvent } from '../record/event'

const isTurnEnded = (event: RecordEvent): boolean => event.type === 'turn-ended'

const isOperatorSaid = (event: RecordEvent): boolean =>
  event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator

export const operatorTurnOf = (args: { events: readonly RecordEvent[] }): boolean => {
  const lastEnd = args.events.findLastIndex(isTurnEnded)
  const previousEnd = lastEnd === -1 ? -1 : args.events.slice(0, lastEnd).findLastIndex(isTurnEnded)
  return args.events.slice(previousEnd + 1).some(isOperatorSaid)
}
