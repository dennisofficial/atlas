import {
  chainHash,
  EMPTY_VISIBILITY,
  isVisible,
  stepVisibility,
  v2EventSchema,
  type V2Event,
  type VisibilityState,
} from '@dltech/atlas-core'
import type { z, ZodError } from 'zod'

export const WINDOW_LIMIT = 3_000

export type SessionCursor = { seq: number; hash: string }

export type SessionWindow = {
  events: V2Event[]
  visibility: VisibilityState
  cursor: SessionCursor | undefined
}

export type EventsPage = { events: readonly unknown[]; head: SessionCursor }

export const EMPTY_WINDOW: SessionWindow = {
  events: [],
  visibility: EMPTY_VISIBILITY,
  cursor: undefined,
}

export const resetWindow = (): SessionWindow => EMPTY_WINDOW

const wireHashOf = (raw: unknown): string => chainHash(raw as V2Event)

type Parsed = { event: V2Event; raw: unknown }

export type UnreadableEvent = { seq: number | undefined; issue: string }

export type PageOutcome = { window: SessionWindow; unreadable: UnreadableEvent | undefined }

const seqOfRaw = (raw: unknown): number | undefined => {
  if (typeof raw !== 'object' || raw === null || !('seq' in raw)) return undefined
  return typeof raw.seq === 'number' ? raw.seq : undefined
}

const issueOf = (error: ZodError): string => {
  const issue = error.issues[0]
  if (issue === undefined) return 'unreadable event'
  return `${issue.path.join('.') || '(root)'}: ${issue.message}`
}

const freshEventsOf = (args: {
  raw: readonly unknown[]
  after: number
  eventSchema: z.ZodType<V2Event>
}): { fresh: Parsed[]; unreadable: UnreadableEvent | undefined } => {
  const fresh: Parsed[] = []
  for (const raw of args.raw) {
    const parsed = args.eventSchema.safeParse(raw)
    if (!parsed.success) {
      return { fresh, unreadable: { seq: seqOfRaw(raw), issue: issueOf(parsed.error) } }
    }
    const last = fresh[fresh.length - 1]
    const floor = last === undefined ? args.after : last.event.seq
    if (parsed.data.seq > floor) fresh.push({ event: parsed.data, raw })
  }
  return { fresh, unreadable: undefined }
}

const cursorAfter = (args: { page: EventsPage; last: Parsed }): SessionCursor => {
  const { page, last } = args
  if (last.event.seq === page.head.seq) return page.head
  return { seq: last.event.seq, hash: wireHashOf(last.raw) }
}

export const applyPageOutcome = (args: {
  window: SessionWindow
  page: EventsPage
  eventSchema?: z.ZodType<V2Event> | undefined
}): PageOutcome => {
  const { window, page } = args
  const { fresh, unreadable } = freshEventsOf({
    raw: page.events,
    after: window.cursor?.seq ?? 0,
    eventSchema: args.eventSchema ?? v2EventSchema,
  })
  const last = fresh[fresh.length - 1]
  if (last === undefined) return { window, unreadable }
  const visibility = fresh.reduce(
    (state, { event }) => stepVisibility(state, event),
    window.visibility,
  )
  const events = [...window.events, ...fresh.map(({ event }) => event)]
    .filter((event) => isVisible(visibility, event))
    .slice(-WINDOW_LIMIT)
  return { window: { events, visibility, cursor: cursorAfter({ page, last }) }, unreadable }
}

export const applyPage = (args: {
  window: SessionWindow
  page: EventsPage
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionWindow => applyPageOutcome(args).window
