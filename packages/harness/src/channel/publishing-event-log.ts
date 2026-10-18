import type { EventLogPort } from '@dltech/atlas-core'

import type { DeltaChannel } from './delta-channel'

export function withDeltaPublishing(args: { log: EventLogPort; channel: DeltaChannel }): EventLogPort {
  return {
    async append(appendArgs) {
      const events = await args.log.append(appendArgs)
      const visible = events.filter((event) => event.type !== 'tool-dispatched')
      if (visible.length > 0) args.channel.publisherFor({ threadId: appendArgs.threadId }).settleAppend({ events: visible })
      return events
    },

    read: (readArgs) => args.log.read(readArgs),
    refresh: (refreshArgs) => args.log.refresh(refreshArgs),
    head: (headArgs) => args.log.head(headArgs),
    readOwn: (readArgs) => args.log.readOwn(readArgs),
    replace: (replaceArgs) => args.log.replace(replaceArgs),
  }
}
