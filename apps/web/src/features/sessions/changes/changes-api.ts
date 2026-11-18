import {
  type EChangeSide,
  type SessionChangeContentOutput,
  type SessionChangesOutput,
} from '@dltech/atlas-protocol'

import { api, cloudCall } from '@/lib/api-client'

export type ChangeContentArgs = {
  sessionId: string
  checkoutId: string
  path: string
  side: EChangeSide
}

export const fetchChanges = (args: { sessionId: string }): Promise<SessionChangesOutput> =>
  cloudCall(api.sessions.changes.query({ sessionId: args.sessionId }))

export const fetchChangeContent = (args: ChangeContentArgs): Promise<SessionChangeContentOutput> =>
  cloudCall(api.sessions.changeContent.query(args))
