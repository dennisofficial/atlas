import type { V2Event } from './event'
import { deriveStatus } from './views/derive-status'
import { initialStatusFacts, stepStatusFacts } from './views/status-facts'
import type { SessionStatus } from './views/status-types'

export { ESessionStatus, type SessionStatus } from './views/status-types'

export function sessionStatusOf(params: {
  events: readonly V2Event[]
  live: boolean
  unconsumedInbox: boolean
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionStatus {
  return deriveStatus({
    facts: params.events.reduce(stepStatusFacts, initialStatusFacts),
    live: params.live,
    unconsumedInbox: params.unconsumedInbox,
    messageAfterFailure: params.messageAfterFailure,
    now: params.now,
  })
}
