import type { ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-client/channel'

import type { SignalFeed } from '../store/conversation-store-types'

export function channelSignalFeed(args: {
  channel: Pick<DeltaChannel, 'subscribe'>
  threadId: ThreadId
}): SignalFeed {
  return {
    subscribe: (listener) => args.channel.subscribe({ threadId: args.threadId, listener }),
  }
}
