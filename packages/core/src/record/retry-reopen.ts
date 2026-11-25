import type { EventDraft } from '../events/body'
import type { RecordEvent } from './event'
import { visibleLoopEvents } from './loop-events'
import { awaitsReplyOf, loopStateOf } from './loop-state'
import { visibleEvents } from './visibility'

export const RETRY_NUDGE =
  'The operator asked you to retry. Your last reply ended early with a provider error. Answer the last request again from where the work stands.'

const REOPEN_LIFETIME_STEPS = 1

const ANSWERS_OR_ASKS: ReadonlySet<string> = new Set([
  'user-said',
  'assistant-said',
  'nudge',
  'resume-marked',
])

export function retryReopenDraftsOf(args: {
  events: readonly RecordEvent[]
}): readonly EventDraft[] {
  const visible = visibleEvents(args.events)
  const failedIndex = visible.findLastIndex((event) => event.type === 'run-failed')
  if (failedIndex === -1) return []
  const answered = visible.slice(failedIndex + 1).some((event) => ANSWERS_OR_ASKS.has(event.type))
  if (answered) return []
  if (awaitsReplyOf(loopStateOf({ events: visibleLoopEvents(args.events) }))) return []
  return [{ type: 'nudge', text: RETRY_NUDGE, lifetimeSteps: REOPEN_LIFETIME_STEPS }]
}
