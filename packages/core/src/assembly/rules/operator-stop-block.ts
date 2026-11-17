import { ELane, envelopeOf } from '../../context/envelope'
import type { AssistantPart } from '../../events/body'
import type { EventOfType } from '../../events/envelope'

export const OPERATOR_STOPPED = 'The operator stopped your previous reply here.'

export const operatorStopBlock = (): string =>
  envelopeOf({ lane: ELane.Notice, source: 'operator-stop', body: OPERATOR_STOPPED })

export const spokenPartsOf = (event: EventOfType<'assistant-said'>): AssistantPart[] =>
  event.parts.filter((part) => part.type === 'text')
