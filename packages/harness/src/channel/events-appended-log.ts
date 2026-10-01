import type { EventLogPort } from '@dltech/atlas-core'

import type { DeltaChannel, ListenerErrorSink } from './delta-channel'

export function withEventsAppendedPublishing(args: {
  log: EventLogPort
  channel: () => DeltaChannel | undefined
  onListenerError?: ListenerErrorSink | undefined
}): EventLogPort {
  return {
    async append(appendArgs) {
      const events = await args.log.append(appendArgs)
      const channel = args.channel()
      if (channel === undefined) return events

      const publisher = channel.publisherFor({ threadId: appendArgs.threadId })
      if (args.onListenerError === undefined) {
        publisher.eventsAppended()
        return events
      }
      publisher.eventsAppended({ onListenerError: args.onListenerError })
      return events
    },

    read: (readArgs) => args.log.read(readArgs),
    refresh: (refreshArgs) => args.log.refresh(refreshArgs),
    head: (headArgs) => args.log.head(headArgs),
    readOwn: (readArgs) => args.log.readOwn(readArgs),
    replace: (replaceArgs) => args.log.replace(replaceArgs),
  }
}
