import { SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import type { EStreamCacheOutcome } from '@dltech/atlas-protocol'

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
  cache: EStreamCacheOutcome
  hydrateMs: number | undefined
}): StreamFollowInput => ({
  sessionId: args.sessionId,
  cache: args.cache,
  ...(args.hydrateMs === undefined ? {} : { hydrateMs: args.hydrateMs }),
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
