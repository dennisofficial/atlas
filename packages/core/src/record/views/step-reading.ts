import type { StepReading } from '../../events/body'
import type { V2Event } from '../event'

export const stepReadingOf = (event: V2Event): StepReading | undefined =>
  event.type === 'assistant-said' || event.type === 'tool-called' ? event.usage : undefined
