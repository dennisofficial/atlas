import { SESSION_VIEW_VERSION } from '@dltech/atlas-core'

import type { SessionCursor } from './session-window'
import type {
  StreamFollowInput,
  StreamSubscription,
  StreamSubscriptionHandlers,
  StreamTransport,
} from './stream-ports'

export const TAIL_REJECTED_STATUS = 400

export const followInputOf = (args: {
  sessionId: string
  threadId: string | undefined
  cursor: SessionCursor | undefined
}): StreamFollowInput => ({
  sessionId: args.sessionId,
  ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
  ...(args.cursor === undefined ? {} : { afterSeq: args.cursor.seq, afterHash: args.cursor.hash }),
})

export type TailFollowArgs = {
  transport: StreamTransport
  input: StreamFollowInput
  handlers: StreamSubscriptionHandlers
  tailUnsupported: boolean
  sawFrame: () => boolean
  onUnsupportedTail: () => void
}

export const followWithTailFallback = (args: TailFollowArgs): StreamSubscription => {
  if (args.tailUnsupported) return args.transport.follow(args.input, args.handlers)
  return args.transport.follow(
    { ...args.input, tailViewVersion: SESSION_VIEW_VERSION },
    {
      ...args.handlers,
      handleFailure: (status) => {
        if (args.sawFrame() || status !== TAIL_REJECTED_STATUS) args.handlers.handleFailure(status)
        else args.onUnsupportedTail()
      },
    },
  )
}
