import { EClientRequest } from '@dltech/atlas-client/channel'
import { readEventsReplySchema, type WireEvent } from '@dltech/atlas-wire/web'

import { appendEvents, headOf } from './live-events'
import type { ServeChannel } from './live-thread-view'

export function createLocalThreadHistory(args: {
  threadId: string
  channel: ServeChannel
  events: () => WireEvent[]
  current: () => boolean
  generation: () => number
  readFreshSeed?: (() => Promise<WireEvent[]>) | undefined
  publish: (events: WireEvent[]) => void
}) {
  let reading: Promise<void> | null = null
  let readAgain = false
  let fullPending = false
  let remotePending = false

  const refresh = (options: { full: boolean; remote?: boolean }): Promise<void> => {
    fullPending ||= options.full
    remotePending ||= options.remote === true
    if (reading) {
      readAgain = true
      return reading
    }
    const read = async () => {
      do {
        readAgain = false
        const generation = args.generation()
        const full = fullPending
        const remote = remotePending
        fullPending = false
        remotePending = false
        if (!args.current()) throw new Error('the sandbox is not connected')
        const events =
          full && !remote && args.readFreshSeed
            ? await args.readFreshSeed()
            : readEventsReplySchema.parse(
                await args.channel.request({
                  op: EClientRequest.ReadEvents,
                  params: {
                    threadId: args.threadId,
                    fromSeq: full ? 0 : headOf(args.events()),
                    own: true,
                  },
                }),
              ).events
        if (!args.current() || generation !== args.generation()) {
          throw new Error('the sandbox disconnected while reading history')
        }
        args.publish(full ? events : appendEvents({ current: args.events(), incoming: events }))
      } while (readAgain)
    }
    reading = read().finally(() => {
      reading = null
    })
    return reading
  }

  return { refresh }
}
