import type { RecordEvent } from './event'
import { deriveStatus } from './views/derive-status'
import { initialStatusFacts, stepStatusFacts } from './views/status-facts'
import type { SessionStatus } from './views/status-types'

export {
  ESessionActivity,
  ESessionStatus,
  isSettledStatus,
  sessionActivityOf,
  type SessionStatus,
} from './views/status-types'

export function sessionStatusOf(params: {
  events: readonly RecordEvent[]
  live: boolean
  queuedSince: string | null
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionStatus {
  return deriveStatus({
    facts: params.events.reduce(stepStatusFacts, initialStatusFacts),
    live: params.live,
    queuedSince: params.queuedSince,
    messageAfterFailure: params.messageAfterFailure,
    now: params.now,
  })
}
