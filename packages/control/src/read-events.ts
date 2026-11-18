import type { V2Event, V2EventType, VisibleSegment } from '@dltech/atlas-core'
import { visibleSegments } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { ControlTx, StoredEvent, ThreadRow } from './port'
import { decodeStoredEvent, decodeVisibility } from './stored-event'

export type ReadEventsPage = { events: V2Event[]; next?: number }

export const INPUT_POSTED = 'input-posted'

const endsCommit = (events: readonly V2Event[]): boolean =>
  events[events.length - 1]?.type !== INPUT_POSTED

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

export const withHiddenTypes = (params: {
  visible: readonly VisibleSegment[]
  fromSeq: number
  throughSeq: number
  types: readonly V2EventType[]
}): VisibleSegment[] => {
  const segments: VisibleSegment[] = []
  let next = params.fromSeq
  for (const segment of params.visible) {
    if (segment.fromSeq > next) {
      segments.push({
        fromSeq: next,
        throughSeq: segment.fromSeq - 1,
        onlyTypes: [...params.types],
      })
    }
    segments.push(
      segment.onlyTypes === undefined
        ? segment
        : { ...segment, onlyTypes: [...new Set([...segment.onlyTypes, ...params.types])] },
    )
    next = segment.throughSeq + 1
  }
  if (next <= params.throughSeq) {
    segments.push({ fromSeq: next, throughSeq: params.throughSeq, onlyTypes: [...params.types] })
  }
  return segments
}

const extendPastCommit = async (params: {
  tx: ControlTx
  row: ThreadRow
  events: V2Event[]
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<V2Event[]> => {
  const { tx, row } = params
  const kept = [...params.events]
  while (!endsCommit(kept)) {
    const last = kept[kept.length - 1]
    if (last === undefined || last.seq >= row.headSeq) return kept
    const page = await readEventsIn({
      tx,
      row,
      afterSeq: last.seq,
      limit: 1,
      visible: false,
      ...(params.eventSchema === undefined ? {} : { eventSchema: params.eventSchema }),
    })
    const next = page.events[0]
    if (next === undefined) return kept
    kept.push(next)
  }
  return kept
}

const segmentsOf = (params: {
  row: ThreadRow
  fromSeq: number
  visible: boolean
  hiddenTypes: readonly V2EventType[] | undefined
}): VisibleSegment[] => {
  const { row, fromSeq } = params
  if (!params.visible) return [{ fromSeq, throughSeq: row.headSeq }]
  const visible = visibleSegments({
    state: decodeVisibility(row.visibility),
    fromSeq,
    throughSeq: row.headSeq,
  })
  if (params.hiddenTypes === undefined) return visible
  return withHiddenTypes({ visible, fromSeq, throughSeq: row.headSeq, types: params.hiddenTypes })
}

export const readEventsIn = async (params: {
  tx: ControlTx
  row: ThreadRow
  afterSeq: number
  limit: number
  visible: boolean
  hiddenTypes?: readonly V2EventType[] | undefined
  maxBytes?: number | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<ReadEventsPage> => {
  const { tx, row } = params
  const segments = segmentsOf({
    row,
    fromSeq: params.afterSeq + 1,
    visible: params.visible,
    hiddenTypes: params.hiddenTypes,
  })
  const rows: StoredEvent[] = []
  for (const segment of segments) {
    if (rows.length >= params.limit) break
    const batch = await tx.readEvents({
      threadId: row.threadId,
      afterSeq: segment.fromSeq - 1,
      throughSeq: segment.throughSeq,
      limit: params.limit - rows.length,
      onlyTypes: segment.onlyTypes,
    })
    rows.push(...batch)
  }
  const bounded =
    params.maxBytes === undefined
      ? { kept: rows, stoppedEarly: false }
      : boundRowsByBytes(rows, params.maxBytes)
  const events = bounded.kept.map((stored) => decodeStoredEvent(stored, params.eventSchema))
  const extended = await extendPastCommit({
    tx,
    row,
    events,
    eventSchema: params.eventSchema,
  })
  const last = extended[extended.length - 1]
  const more =
    last !== undefined &&
    (bounded.stoppedEarly || (extended.length >= params.limit && last.seq < row.headSeq))
  return more ? { events: extended, next: last.seq } : { events: extended }
}
