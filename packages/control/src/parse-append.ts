import { v2EventSchema, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { ControlRefusal } from './refusal'

export type ParsedAppend = { ok: true; events: V2Event[] } | { ok: false; refusal: ControlRefusal }

const seqOf = (raw: unknown, fallback: number): number =>
  typeof raw === 'object' && raw !== null && 'seq' in raw && typeof raw.seq === 'number'
    ? raw.seq
    : fallback

const malformed = (params: { raw: unknown; fallback: number; issue: string }): ParsedAppend => ({
  ok: false,
  refusal: { kind: 'malformed', atSeq: seqOf(params.raw, params.fallback), issue: params.issue },
})

export function parseAppendEvents(params: {
  threadId: string
  nextSeq: number
  raw: readonly unknown[]
  eventSchema?: z.ZodType<V2Event> | undefined
}): ParsedAppend {
  const schema = params.eventSchema ?? v2EventSchema
  const events: V2Event[] = []
  for (const raw of params.raw) {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'invalid event'
      return malformed({ raw, fallback: params.nextSeq, issue })
    }
    const event = parsed.data
    if (event.threadId !== params.threadId) {
      return malformed({
        raw,
        fallback: params.nextSeq,
        issue: 'threadId does not match the thread',
      })
    }
    if (Number.isNaN(Date.parse(event.at))) {
      return malformed({ raw, fallback: params.nextSeq, issue: 'at is not a timestamp' })
    }
    events.push(event)
  }
  return { ok: true, events }
}
