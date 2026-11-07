import { canonicalEvent, type V2Event } from '@dltech/atlas-core'

export const EVENTS_DEFAULT_MAX_BYTES = 2_000_000
const EVENTS_HARD_CEILING_BYTES = 3_500_000
export const BLOB_READ_DEFAULT_LENGTH = 1_000_000

export const toPageEvent = (event: V2Event): Record<string, unknown> => {
  const bytes = Buffer.byteLength(canonicalEvent(event), 'utf8')
  if (bytes <= EVENTS_HARD_CEILING_BYTES) return event as Record<string, unknown>
  return { seq: event.seq, type: event.type, oversized: { bytes } }
}
