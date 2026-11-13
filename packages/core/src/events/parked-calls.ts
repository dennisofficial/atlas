import type { Event } from './envelope'
import type { CallId } from './ids'
import type { JsonValue } from '../json/value'

export type OpenParkedCall = {
  callId: CallId
  name: string
  request?: JsonValue | undefined
  seq: number
}

export const openParkedCallsOf = (events: readonly Event[]): readonly OpenParkedCall[] => {
  const open = new Map<CallId, OpenParkedCall>()

  for (const event of events) {
    if (event.type === 'tool-parked') {
      open.set(event.callId, {
        callId: event.callId,
        name: event.name,
        ...(event.request === undefined ? {} : { request: event.request }),
        seq: event.seq,
      })
      continue
    }
    if (
      event.type === 'tool-called' ||
      event.type === 'tool-result' ||
      event.type === 'tool-denied'
    )
      open.delete(event.callId)
  }

  return [...open.values()].sort((left, right) => left.seq - right.seq)
}
