import type { SessionStatusOutput } from '@dltech/atlas-protocol'

import type { ControlPlane } from './control-plane'

export const STATUS_EVENT_LIMIT = 1000

export type StatusPlane = Pick<ControlPlane, 'readSessionView'>

export type SessionStatusRead = { at: number; value: SessionStatusOutput }

export const readSessionStatus = async (args: {
  plane: StatusPlane
  sessionId: string
  threadId: string
}): Promise<SessionStatusRead> => {
  const { at, value } = await args.plane.readSessionView({
    sessionId: args.sessionId,
    threadId: args.threadId,
  })
  return { at, value: value.status }
}
