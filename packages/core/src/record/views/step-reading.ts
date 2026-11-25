import type { StepReading } from '../../events/body'
import type { RecordEvent } from '../event'

export const stepReadingOf = (event: RecordEvent): StepReading | undefined =>
  event.type === 'assistant-said' || event.type === 'tool-called' ? event.usage : undefined
