import type { Event, EventOfType } from '../events/envelope'
import { RECORD_ONLY_TYPES, type V2Event } from './event'
import { visibleEvents } from './visibility'

type Summarised = Extract<V2Event, { type: 'history-summarised' }>

export const isRecordOnly = (event: V2Event): boolean => RECORD_ONLY_TYPES.has(event.type)

function summaryAsCompaction(summary: Summarised): EventOfType<'history-compacted'> {
  const { epoch: _epoch, prevHash: _prevHash, type: _type, ...rest } = summary
  return {
    ...rest,
    type: 'history-compacted',
    replaced: summary.throughSeq - summary.fromSeq + 1,
  }
}

/** A summary reaches the loop as the compaction watermark it already renders; other record-only bodies are dropped. */
export function toLoopEvent({ event }: { event: V2Event }): Event | undefined {
  if (event.type === 'history-summarised') return summaryAsCompaction(event)
  if (isRecordOnly(event)) return undefined
  const { epoch: _epoch, prevHash: _prevHash, ...loop } = event
  return loop as Event
}

export function visibleLoopEvents(log: readonly V2Event[]): Event[] {
  return visibleEvents(log).flatMap((event) => {
    const loop = toLoopEvent({ event })
    return loop === undefined ? [] : [loop]
  })
}
