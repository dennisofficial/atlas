import { KEPT_THROUGH_COMPACTION } from '../compaction/disposition'
import type { Event, EventOfType } from '../events/envelope'
import type { V2Event, V2EventType } from './event'
import { visibleEvents } from './visibility'

const RECORD_ONLY_TYPES: ReadonlySet<V2EventType> = new Set<V2EventType>([
  'history-rewound',
  'history-summarised',
  'input-consumed',
  'fact-recorded',
  'branches-observed',
  'workspace-prepared',
  'workspace-prepare-failed',
  'session-start-failed',
])

const SURVIVOR_TYPES: ReadonlySet<string> = new Set<string>(KEPT_THROUGH_COMPACTION)

type Summarised = Extract<V2Event, { type: 'history-summarised' }>

export const isRecordOnly = (event: V2Event): boolean => RECORD_ONLY_TYPES.has(event.type)

const vacatedBy = ({ summary, log }: { summary: Summarised; log: readonly V2Event[] }): number =>
  log.filter(
    (event) =>
      event.seq >= summary.fromSeq &&
      event.seq <= summary.throughSeq &&
      !SURVIVOR_TYPES.has(event.type),
  ).length

function summaryAsCompaction({
  summary,
  log,
}: {
  summary: Summarised
  log: readonly V2Event[]
}): EventOfType<'history-compacted'> {
  const { epoch: _epoch, prevHash: _prevHash, type: _type, ...rest } = summary
  return { ...rest, type: 'history-compacted', replaced: vacatedBy({ summary, log }) }
}

/** A summary reaches the loop as the compaction watermark it already renders; other record-only bodies are dropped. */
export function toLoopEvent({
  event,
  log,
}: {
  event: V2Event
  log: readonly V2Event[]
}): Event | undefined {
  if (event.type === 'history-summarised') return summaryAsCompaction({ summary: event, log })
  if (isRecordOnly(event)) return undefined
  const { epoch: _epoch, prevHash: _prevHash, ...loop } = event
  return loop as Event
}

export function visibleLoopEvents(log: readonly V2Event[]): Event[] {
  return visibleEvents(log).flatMap((event) => {
    const loop = toLoopEvent({ event, log })
    return loop === undefined ? [] : [loop]
  })
}
