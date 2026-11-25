import { withholdPictureBytes, type RecordEvent } from '@dltech/atlas-core'

export const withheldEvents = (events: readonly RecordEvent[]): RecordEvent[] =>
  events.map((event) => withholdPictureBytes(event))

export const pageCursorOf = (page: {
  events: readonly RecordEvent[]
  lastHash?: string | undefined
}): { seq: number; hash: string } | undefined => {
  const last = page.events[page.events.length - 1]
  if (last === undefined || page.lastHash === undefined) return undefined
  return { seq: last.seq, hash: page.lastHash }
}
