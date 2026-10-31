import { EClientRequest, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { readEventsReplySchema, type WireEvent } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'
import { appendEvents, headOf } from './live-events'

export function createLiveEventReader(args: {
  threadId: string
  channel: () => RemoteDeltaChannel | null
  events: () => WireEvent[]
  closed: () => boolean
  onEvents: (events: WireEvent[]) => void
  onFailure: () => void
}) {
  let generation = 0
  const runner = createCoalescedRunner({
    run: async () => {
      const live = args.channel()
      if (live === null || args.closed()) return
      const readGeneration = generation
      const superseded = () => args.closed() || readGeneration !== generation
      try {
        const reply = await live.request({
          op: EClientRequest.ReadEvents,
          params: { threadId: args.threadId, fromSeq: headOf(args.events()), own: true },
        })
        if (superseded()) return
        const { events } = readEventsReplySchema.parse(reply)
        args.onEvents(appendEvents({ current: args.events(), incoming: events }))
      } catch {
        if (!superseded()) args.onFailure()
      }
    },
  })
  return {
    read: runner.trigger,
    invalidate: () => {
      generation += 1
    },
  }
}
