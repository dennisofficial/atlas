import type { Event, V2Event } from '@dltech/atlas-core'

const RECORD_ONLY_TYPES: ReadonlySet<string> = new Set([
  'history-rewound',
  'history-summarised',
  'input-consumed',
  'fact-recorded',
  'branches-observed',
])

export const isRecordOnly = (event: V2Event): boolean => RECORD_ONLY_TYPES.has(event.type)

export function toLoopEvent(event: V2Event): Event | undefined {
  if (isRecordOnly(event)) return undefined
  const { epoch: _epoch, prevHash: _prevHash, ...loop } = event
  return loop as Event
}
