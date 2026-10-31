import { EThreadStreamFrame, type WireEvent } from '@dltech/atlas-wire'
import type { ThreadFrameSignal } from './thread-signal.bus'

export const EVENT_INLINE_LIMIT_BYTES = 32 * 1024
export type EventsAppended = {
  threadId: string
  events: readonly WireEvent[]
  head: number
  historyRev: number
}
export type EventsReset = { threadId: string; head: number; historyRev: number }

export async function publishEventChange(args: {
  change: EventsAppended | EventsReset
  publish: (signal: ThreadFrameSignal) => Promise<void>
  threadChanged: () => void
}): Promise<void> {
  const { threadId, head, historyRev } = args.change
  if ('events' in args.change && args.change.events.length === 0) return
  const events = 'events' in args.change ? [...args.change.events] : undefined
  const frame =
    events === undefined
      ? ({ type: EThreadStreamFrame.Reset, head, historyRev } as const)
      : ({
          type: EThreadStreamFrame.Events,
          fromSeq: events[0]?.seq ?? head,
          events,
          historyRev,
        } as const)
  const signal = { threadId, frame }
  if (
    frame.type === EThreadStreamFrame.Events &&
    Buffer.byteLength(JSON.stringify(signal)) > EVENT_INLINE_LIMIT_BYTES
  ) {
    await args.publish({ threadId, frame: { ...frame, events: [] } })
  } else {
    await args.publish(signal)
  }
  await args.publish({ threadId, frame: { type: EThreadStreamFrame.Head, head, historyRev } })
  args.threadChanged()
}
