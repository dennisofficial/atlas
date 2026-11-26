import { INBOX_KIND_EVENT, inboxEventPayloadOf, type EventBody } from '@dltech/atlas-core'

import type { HeldSessionDeps } from './held-session-deps'

export const postNoticeToSession = async (args: {
  deps: HeldSessionDeps
  event: EventBody
  key: string
}): Promise<void> => {
  await args.deps.plane.post({
    sessionId: args.deps.sessionId,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({ event: args.event, clientId: args.key }),
  })
}
