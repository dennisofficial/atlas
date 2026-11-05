import {
  chainHash,
  EMPTY_VISIBILITY,
  isVisible,
  stepVisibility,
  v2EventSchema,
  type V2Event,
  type VisibilityState,
} from '@dltech/atlas-core'

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

const freshEventsOf = (args: { raw: readonly unknown[]; after: number }): Parsed[] => {
  const fresh: Parsed[] = []
  for (const raw of args.raw) {
    const parsed = v2EventSchema.safeParse(raw)
    if (!parsed.success) continue
    const last = fresh[fresh.length - 1]
    const floor = last === undefined ? args.after : last.event.seq
    if (parsed.data.seq > floor) fresh.push({ event: parsed.data, raw })
  }
  return fresh
}

const cursorAfter = (args: { page: EventsPage; last: Parsed }): SessionCursor => {
  const { page, last } = args
  if (last.event.seq === page.head.seq) return page.head
  return { seq: last.event.seq, hash: wireHashOf(last.raw) }
}

export const applyPage = (args: { window: SessionWindow; page: EventsPage }): SessionWindow => {
  const { window, page } = args
  const fresh = freshEventsOf({ raw: page.events, after: window.cursor?.seq ?? 0 })
  const last = fresh[fresh.length - 1]
  if (last === undefined) return window
  const visibility = fresh.reduce(
    (state, { event }) => stepVisibility(state, event),
    window.visibility,
  )
  const events = [...window.events, ...fresh.map(({ event }) => event)]
    .filter((event) => isVisible(visibility, event))
    .slice(-WINDOW_LIMIT)
  return { events, visibility, cursor: cursorAfter({ page, last }) }
}
