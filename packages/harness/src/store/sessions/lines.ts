import { Buffer } from 'node:buffer'
import { readFile, truncate } from 'node:fs/promises'

import {
  eventBodySchema,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type EventEnvelope,
} from '@dltech/atlas-core'

import { EUnreadableReason, type UnreadableRow } from '../decode-events'

export const EVENT_LINE_VERSION = 1

type EventLineUpcaster = (line: Record<string, unknown>) => Record<string, unknown>

const EVENT_LINE_UPCASTERS: ReadonlyMap<number, EventLineUpcaster> = new Map()

export function upcastEventLine({
  raw,
  version,
}: {
  raw: unknown
  version: number
}): { ok: true; line: unknown } | { ok: false; reason: 'newer' | 'no-path' } {
  if (version > EVENT_LINE_VERSION) return { ok: false, reason: 'newer' }
  let line = raw
  for (let v = version; v < EVENT_LINE_VERSION; v += 1) {
    const upcast = EVENT_LINE_UPCASTERS.get(v)
    if (upcast === undefined) return { ok: false, reason: 'no-path' }
    line = upcast(line as Record<string, unknown>)
  }
  return { ok: true, line }
}

export type EventLine = {
  v: number
  id: string
  seq: number
  threadId: string
  runId: string
  parentRunId?: string
  depth: number
  at: string
  type: string
  body: unknown
}

export class UnreadableWrite extends Error {
  constructor(args: { type: string; detail: string }) {
    super(`refusing to write a ${args.type} event Atlas could not read back: ${args.detail}`)
    this.name = 'UnreadableWrite'
  }
}

export async function dropTornTail({ file }: { file: string }): Promise<boolean> {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (text === undefined || text === '' || text.endsWith('\n')) return false
  const kept = text.slice(0, text.lastIndexOf('\n') + 1)
  await truncate(file, Buffer.byteLength(kept))
  return true
}

export function encodeEventLine({
  draft,
  envelope,
}: {
  draft: EventDraft
  envelope: EventEnvelope
}): string {
  const probe = eventBodySchema.safeParse(JSON.parse(JSON.stringify(draft)))
  if (!probe.success) throw new UnreadableWrite({ type: draft.type, detail: probe.error.message })

  const line: EventLine = {
    v: EVENT_LINE_VERSION,
    id: envelope.id,
    seq: envelope.seq,
    threadId: envelope.threadId,
    runId: envelope.runId,
    ...(envelope.parentRunId === undefined ? {} : { parentRunId: envelope.parentRunId }),
    depth: envelope.depth,
    at: envelope.at,
    type: draft.type,
    body: draft,
  }
  return JSON.stringify(line)
}

export type ParsedLog = {
  events: Event[]
  unreadable: UnreadableRow[]
  head: number
}

export function parseEventLines({
  text,
  threadId,
}: {
  text: string
  threadId: string
}): ParsedLog {
  const events: Event[] = []
  const unreadable: UnreadableRow[] = []
  const segments = text.split('\n')
  const last = segments.length - 1

  for (let index = 0; index < segments.length; index += 1) {
    const raw = segments[index]
    if (raw === undefined || raw === '') continue

    const decoded = decodeLine({ raw, threadId, tail: index === last })
    if ('gap' in decoded) {
      unreadable.push(decoded.gap)
      continue
    }
    events.push(decoded.event)
  }

  const tail = events[events.length - 1]
  return { events, unreadable, head: tail?.seq ?? 0 }
}

type LineOutcome = { event: Event } | { gap: UnreadableRow; reason: EUnreadableReason }

function decodeLine({ raw, threadId, tail }: { raw: string; threadId: string; tail: boolean }): LineOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const reason = tail ? EUnreadableReason.TruncatedTail : EUnreadableReason.MalformedJson
    return {
      reason,
      gap: gapOf({ raw, threadId, reason, detail: messageOf(error) }),
    }
  }

  const version = lineVersionOf({ parsed })
  const upcasted = upcastEventLine({ raw: parsed, version })
  if (!upcasted.ok) {
    const reason = EUnreadableReason.NewerVersion
    return {
      reason,
      gap: gapOf({
        raw,
        threadId,
        reason,
        detail:
          upcasted.reason === 'newer'
            ? `written by a newer Atlas (event line v${version}, this build reads v${EVENT_LINE_VERSION}); upgrade before opening this session`
            : `no upcast path from event line v${version} to v${EVENT_LINE_VERSION}`,
      }),
    }
  }

  const line = upcasted.line as Partial<EventLine>
  if (
    typeof line.id !== 'string' ||
    typeof line.seq !== 'number' ||
    typeof line.runId !== 'string' ||
    typeof line.depth !== 'number' ||
    typeof line.at !== 'string' ||
    typeof line.type !== 'string'
  ) {
    return {
      reason: EUnreadableReason.CorruptEnvelope,
      gap: gapOf({ raw, threadId, reason: EUnreadableReason.CorruptEnvelope, detail: 'envelope fields missing or mistyped' }),
    }
  }

  const body = eventBodySchema.safeParse(line.body)
  if (!body.success) {
    return {
      reason: EUnreadableReason.UnrecognizedBody,
      gap: gapOf({ raw, threadId, reason: EUnreadableReason.UnrecognizedBody, detail: messageOf(body.error) }),
    }
  }

  const envelope: EventEnvelope = {
    id: toEventId(line.id),
    seq: line.seq,
    threadId: toThreadId(threadId),
    runId: toRunId(line.runId),
    depth: line.depth,
    at: line.at,
    ...(line.parentRunId === undefined ? {} : { parentRunId: toRunId(line.parentRunId) }),
  }
  return { event: stampEvent({ draft: body.data as EventDraft, envelope }) }
}

function lineVersionOf({ parsed }: { parsed: unknown }): number {
  if (typeof parsed !== 'object' || parsed === null) return EVENT_LINE_VERSION
  const v = (parsed as { v?: unknown }).v
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : EVENT_LINE_VERSION
}

function gapOf({
  raw,
  threadId,
  reason,
  detail,
}: {
  raw: string
  threadId: string
  reason: EUnreadableReason
  detail: string
}): UnreadableRow {
  const line = safePartial(raw)
  return {
    id: line.id ?? '',
    seq: line.seq ?? 0,
    threadId,
    type: line.type ?? '',
    reason,
    detail,
  }
}

function safePartial(raw: string): { id?: string; seq?: number; type?: string } {
  try {
    return JSON.parse(raw) as { id?: string; seq?: number; type?: string }
  } catch {
    return {}
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
