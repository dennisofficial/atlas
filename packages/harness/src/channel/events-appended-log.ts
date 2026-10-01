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

      // The append is durable once it resolves, so nothing in the publish that follows may
      // reject back out of it — a throwing channel would read as a failed write and lose the
      // wake for an ending that is in fact recorded.
      try {
        const channel = args.channel()
        if (channel === undefined) return events

        const publisher = channel.publisherFor({ threadId: appendArgs.threadId })
        if (args.onListenerError === undefined) {
          publisher.eventsAppended()
          return events
        }
        publisher.eventsAppended({ onListenerError: args.onListenerError })
      } catch (cause) {
        args.onListenerError?.(cause)
      }
      return events
    },

    read: (readArgs) => args.log.read(readArgs),
    refresh: (refreshArgs) => args.log.refresh(refreshArgs),
    head: (headArgs) => args.log.head(headArgs),
    readOwn: (readArgs) => args.log.readOwn(readArgs),
    replace: (replaceArgs) => args.log.replace(replaceArgs),
  }
}
