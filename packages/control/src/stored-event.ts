import {
  canonicalEvent,
  canonicalJson,
  EMPTY_VISIBILITY,
  sha256Hex,
  v2EventSchema,
  type Hash,
  type V2Event,
  type VisibilityState,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { RecordCorruptError } from './refusal'
import type { StoredEvent } from './port'

const visibilitySchema: z.ZodType<VisibilityState> = z.object({
  spans: z.array(
    z.object({
      createdAt: z.number().int(),
      fromSeq: z.number().int(),
      throughSeq: z.number().int(),
      keepSurvivors: z.boolean(),
    }),
  ),
})

export const encodeVisibility = (state: VisibilityState): string => canonicalJson(state)

export const EMPTY_VISIBILITY_TEXT = encodeVisibility(EMPTY_VISIBILITY)

export function decodeVisibility(text: string): VisibilityState {
  const parsed = visibilitySchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new RecordCorruptError('stored visibility state is invalid')
  return parsed.data
}

export const toStoredEvent = (params: { event: V2Event; hash: Hash }): StoredEvent => ({
  threadId: params.event.threadId,
  seq: params.event.seq,
  id: params.event.id,
  epoch: params.event.epoch,
  type: params.event.type,
  runId: params.event.runId,
  at: params.event.at,
  prevHash: params.event.prevHash,
  hash: params.hash,
  canonical: canonicalEvent(params.event),
})

export function decodeStoredEvent(
  row: StoredEvent,
  eventSchema: z.ZodType<V2Event> = v2EventSchema,
): V2Event {
  const digest = sha256Hex(new TextEncoder().encode(row.canonical))
  if (digest !== row.hash) {
    throw new RecordCorruptError(`hash mismatch at ${row.threadId}:${row.seq}`)
  }
  const parsed = eventSchema.safeParse(JSON.parse(row.canonical))
  if (!parsed.success) {
    throw new RecordCorruptError(`stored event ${row.threadId}:${row.seq} is invalid`)
  }
  if (parsed.data.seq !== row.seq || parsed.data.threadId !== row.threadId) {
    throw new RecordCorruptError(`stored event ${row.threadId}:${row.seq} disagrees with its row`)
  }
  return parsed.data
}
