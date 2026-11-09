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

type Seen = { seq: number; raw: unknown }

export type PageOutcome = { window: SessionWindow; skipped: number; issue: string | undefined }

const seqOfRaw = (raw: unknown): number | undefined => {
  if (typeof raw !== 'object' || raw === null || !('seq' in raw)) return undefined
  return typeof raw.seq === 'number' ? raw.seq : undefined
}

const issueOf = (error: ZodError): string => {
  const issue = error.issues[0]
  if (issue === undefined) return 'unreadable event'
  return `${issue.path.join('.') || '(root)'}: ${issue.message}`
}

const readPage = (args: {
  raw: readonly unknown[]
  after: number
  eventSchema: z.ZodType<V2Event>
}): { fresh: Parsed[]; last: Seen | undefined; skipped: number; issue: string | undefined } => {
  const fresh: Parsed[] = []
  let last: Seen | undefined
  let skipped = 0
  let issue: string | undefined
  let floor = args.after
  for (const raw of args.raw) {
    const parsed = args.eventSchema.safeParse(raw)
    const seq = parsed.success ? parsed.data.seq : seqOfRaw(raw)
    if (seq === undefined || seq <= floor) continue
    floor = seq
    last = { seq, raw }
    if (parsed.success) fresh.push({ event: parsed.data, raw })
    else {
      skipped += 1
      issue ??= issueOf(parsed.error)
    }
  }
  return { fresh, last, skipped, issue }
}

const cursorAfter = (args: { page: EventsPage; last: Seen }): SessionCursor =>
  args.last.seq === args.page.head.seq
    ? args.page.head
    : { seq: args.last.seq, hash: wireHashOf(args.last.raw) }

export const applyPageOutcome = (args: {
  window: SessionWindow
  page: EventsPage
  eventSchema?: z.ZodType<V2Event> | undefined
}): PageOutcome => {
  const { window, page } = args
  const { fresh, last, skipped, issue } = readPage({
    raw: page.events,
    after: window.cursor?.seq ?? 0,
    eventSchema: args.eventSchema ?? v2EventSchema,
  })
  if (last === undefined) return { window, skipped, issue }
  const visibility = fresh.reduce(
    (state, { event }) => stepVisibility(state, event),
    window.visibility,
  )
  const events = [...window.events, ...fresh.map(({ event }) => event)]
    .filter((event) => isVisible(visibility, event))
    .slice(-WINDOW_LIMIT)
  return { window: { events, visibility, cursor: cursorAfter({ page, last }) }, skipped, issue }
}

export const applyPage = (args: {
  window: SessionWindow
  page: EventsPage
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionWindow => applyPageOutcome(args).window
