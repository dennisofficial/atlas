import type { RecordEvent, RecordEventType, VisibleSegment } from '@dltech/atlas-core'
import { visibleSegments } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { ControlTx, StoredEvent, ThreadRow } from './port'
import { decodeStoredEvent, decodeVisibility } from './stored-event'

export type ReadEventsPage = { events: RecordEvent[]; next?: number; lastHash?: string | undefined }

export const INPUT_POSTED = 'input-posted'

const COMMIT_EXTENSION_PAGE = 64

const endsCommit = (events: readonly RecordEvent[]): boolean =>
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
  types: readonly RecordEventType[]
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
  events: RecordEvent[]
  lastHash?: string | undefined
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): Promise<{ events: RecordEvent[]; lastHash?: string | undefined }> => {
  const { tx, row } = params
  const kept = [...params.events]
  let lastHash = params.lastHash
  const done = (): { events: RecordEvent[]; lastHash?: string | undefined } => ({
    events: kept,
    lastHash,
  })
  while (!endsCommit(kept)) {
    const last = kept[kept.length - 1]
    if (last === undefined || last.seq >= row.headSeq) return done()
    const batch = await tx.readEvents({
      threadId: row.threadId,
      afterSeq: last.seq,
      throughSeq: row.headSeq,
      limit: COMMIT_EXTENSION_PAGE,
    })
    if (batch.length === 0) return done()
    for (const stored of batch) {
      kept.push(decodeStoredEvent(stored, params.eventSchema))
      lastHash = stored.hash
      if (endsCommit(kept)) return done()
    }
  }
  return done()
}

const narrowToTypes = (args: {
  segments: readonly VisibleSegment[]
  onlyTypes: readonly RecordEventType[]
}): VisibleSegment[] =>
  args.segments.flatMap((segment) => {
    const kept =
      segment.onlyTypes === undefined
        ? [...args.onlyTypes]
        : segment.onlyTypes.filter((type) => args.onlyTypes.includes(type))
    return kept.length === 0 ? [] : [{ ...segment, onlyTypes: kept }]
  })

const segmentsOf = (params: {
  row: ThreadRow
  fromSeq: number
  visible: boolean
  hiddenTypes: readonly RecordEventType[] | undefined
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
  hiddenTypes?: readonly RecordEventType[] | undefined
  onlyTypes?: readonly RecordEventType[] | undefined
  maxBytes?: number | undefined
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): Promise<ReadEventsPage> => {
  const { tx, row } = params
  const whole = segmentsOf({
    row,
    fromSeq: params.afterSeq + 1,
    visible: params.visible,
    hiddenTypes: params.hiddenTypes,
  })
  const segments =
    params.onlyTypes === undefined
      ? whole
      : narrowToTypes({ segments: whole, onlyTypes: params.onlyTypes })
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
  const boundaries =
    params.maxBytes === undefined
      ? { kept: rows, stoppedEarly: false }
      : boundRowsByBytes(rows, params.maxBytes)
  const events = boundaries.kept.map((stored) => decodeStoredEvent(stored, params.eventSchema))
  const tail = boundaries.kept[boundaries.kept.length - 1]
  const extended =
    params.onlyTypes === undefined
      ? await extendPastCommit({
          tx,
          row,
          events,
          lastHash: tail?.hash,
          eventSchema: params.eventSchema,
        })
      : { events, lastHash: tail?.hash }
  const last = extended.events[extended.events.length - 1]
  const more =
    last !== undefined &&
    (boundaries.stoppedEarly || (extended.events.length >= params.limit && last.seq < row.headSeq))
  return more
    ? { events: extended.events, next: last.seq, lastHash: extended.lastHash }
    : { events: extended.events, lastHash: extended.lastHash }
}
