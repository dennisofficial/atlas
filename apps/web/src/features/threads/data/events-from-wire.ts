import {
  eventBodySchema,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
} from '@dltech/atlas-core'
import { BOOT_STEP_EVENT_TYPE, type WireEvent } from '@dltech/atlas-wire/web'

function eventOfWire(wire: WireEvent): Event | null {
  if (wire.type === BOOT_STEP_EVENT_TYPE) return null
  try {
    const body = eventBodySchema.safeParse(JSON.parse(wire.body))
    if (!body.success) return null
    return stampEvent({
      draft: body.data,
      envelope: {
        id: toEventId(wire.id),
        seq: wire.seq,
        threadId: toThreadId(wire.threadId),
        runId: toRunId(wire.runId),
        depth: wire.depth,
        at: wire.at,
        ...(wire.parentRunId === undefined ? {} : { parentRunId: toRunId(wire.parentRunId) }),
      },
    })
  } catch {
    return null
  }
}

export function eventsFromWire(wire: readonly WireEvent[]): Event[] {
  return wire
    .flatMap((row) => {
      const event = eventOfWire(row)
      return event === null ? [] : [event]
    })
    .sort((left, right) => left.seq - right.seq)
}
