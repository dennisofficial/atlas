import type { V2Event } from '@dltech/atlas-core'
import { visibleSegments } from '@dltech/atlas-core'

import type { ControlTx, StoredEvent, ThreadRow } from './port'
import { decodeStoredEvent, decodeVisibility } from './stored-event'

export type ReadEventsPage = { events: V2Event[]; next?: number }

const boundRowsByBytes = (
  rows: readonly StoredEvent[],
  maxBytes: number,
): { kept: StoredEvent[]; stoppedEarly: boolean } => {
  const kept: StoredEvent[] = []
  let bytes = 0
  for (const row of rows) {
    const size = Buffer.byteLength(row.canonical, 'utf8')
    if (kept.length > 0 && bytes + size > maxBytes) return { kept, stoppedEarly: true }
    bytes += size
    kept.push(row)
  }
  return { kept, stoppedEarly: false }
}

export const readEventsIn = async (params: {
  tx: ControlTx
  row: ThreadRow
  afterSeq: number
  limit: number
  visible: boolean
  maxBytes?: number | undefined
}): Promise<ReadEventsPage> => {
  const { tx, row } = params
  const fromSeq = params.afterSeq + 1
  const segments = params.visible
    ? visibleSegments({
        state: decodeVisibility(row.visibility),
        fromSeq,
        throughSeq: row.headSeq,
      })
    : [{ fromSeq, throughSeq: row.headSeq }]
  const rows: StoredEvent[] = []
  for (const segment of segments) {
    if (rows.length >= params.limit) break
    const batch = await tx.readEvents({
      threadId: row.threadId,
      afterSeq: segment.fromSeq - 1,
      throughSeq: segment.throughSeq,
      limit: params.limit - rows.length,
      onlyTypes: 'onlyTypes' in segment ? segment.onlyTypes : undefined,
    })
    rows.push(...batch)
  }
  const bounded =
    params.maxBytes === undefined
      ? { kept: rows, stoppedEarly: false }
      : boundRowsByBytes(rows, params.maxBytes)
  const events = bounded.kept.map(decodeStoredEvent)
  const last = events[events.length - 1]
  const more =
    last !== undefined &&
    (bounded.stoppedEarly || (events.length === params.limit && last.seq < row.headSeq))
  return more ? { events, next: last.seq } : { events }
}
