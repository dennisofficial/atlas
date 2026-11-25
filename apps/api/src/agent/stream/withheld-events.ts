import { chainHash, withholdPictureBytes, type RecordEvent } from '@dltech/atlas-core'

export const withheldEvents = (events: readonly RecordEvent[]): RecordEvent[] =>
  events.map((event) => withholdPictureBytes(event))

export const pageCursorOf = (
  last: RecordEvent | undefined,
): { seq: number; hash: string } | undefined =>
  last === undefined ? undefined : { seq: last.seq, hash: chainHash(last) }
