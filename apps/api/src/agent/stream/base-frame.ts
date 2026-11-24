import type { StreamServerMessage } from '@dltech/atlas-protocol'

import type { FollowPlane } from './follow-types'

export const tailBaseOf = async (args: {
  plane: FollowPlane
  id: string
  sessionId: string
  threadId: string
  tailFrom: number
}): Promise<{ cursor: number; frame: StreamServerMessage } | undefined> => {
  const base = await args.plane.readTailBase({
    sessionId: args.sessionId,
    threadId: args.threadId,
    tailFrom: args.tailFrom,
  })
  if (base === undefined) return undefined
  return {
    cursor: args.tailFrom - 1,
    frame: {
      type: 'base',
      id: args.id,
      cursor: base.cursor,
      visibility: base.visibility,
      view: base.view,
      durable: base.durable.map((event) => ({ ...event })),
      commandLog: base.commandLog.map((event) => ({ ...event })),
    },
  }
}
