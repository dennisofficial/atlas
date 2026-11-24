import {
  chainHash,
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  initialFailureMessage,
  foldableOf,
  initialSessionViewState,
  isCommandLogEvent,
  isDurable,
  visibleWithin,
  needsRebuild,
  rebuildEditSensitive,
  stepFailureMessage,
  stepPending,
  stepSessionViewWith,
  stepVisibility,
  v2EventSchema,
  type FailureMessageState,
  type PendingInputsState,
  type PluginViewFold,
  type SessionViewState,
  type V2Event,
  type VisibilityState,
} from '@dltech/atlas-core'
import type { z, ZodError } from 'zod'

import { isQuickStopEvidenceRow } from '../session/quick-stop-restore'

export const RENDER_LIMIT = 3_000

export const OLDER_PAGE = 200

export type SessionCursor = { seq: number; hash: string }

export type SessionWindow = {
  events: V2Event[]
  visibility: VisibilityState
  pending: PendingInputsState
  view: SessionViewState
  failureMessage: FailureMessageState
  durable: readonly V2Event[]
  foldable: readonly V2Event[]
  commandLog: readonly V2Event[]
  quickStopRows: readonly V2Event[]
  cursor: SessionCursor | undefined
  foldedThrough: number
}

export type EventsPage = { events: readonly unknown[]; head: SessionCursor }

export const EMPTY_WINDOW: SessionWindow = {
  events: [],
  visibility: EMPTY_VISIBILITY,
  pending: EMPTY_PENDING,
  view: initialSessionViewState,
  failureMessage: initialFailureMessage,
  durable: [],
  foldable: [],
  commandLog: [],
  quickStopRows: [],
  cursor: undefined,
  foldedThrough: 0,
}

export const resetWindow = (): SessionWindow => EMPTY_WINDOW

const wireHashOf = (raw: unknown): string => chainHash(raw as V2Event)

type Parsed = { event: V2Event; raw: unknown }

type Seen = { seq: number; raw: unknown }

export type PageOutcome = {
  window: SessionWindow
  fresh: readonly V2Event[]
  skipped: number
  issue: string | undefined
}

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
  renderLimit?: number | undefined
  views?: readonly PluginViewFold[] | undefined
}): PageOutcome => {
  const { window, page } = args
  const views = args.views ?? []
  const { fresh, last, skipped, issue } = readPage({
    raw: page.events,
    after: window.cursor?.seq ?? 0,
    eventSchema: args.eventSchema ?? v2EventSchema,
  })
  if (last === undefined) return { window, fresh: [], skipped, issue }
  const events = fresh.map(({ event }) => event)
  const unfolded = events.filter((event) => event.seq > window.foldedThrough)
  const visibility = unfolded.reduce(
    (state, event) => stepVisibility(state, event),
    window.visibility,
  )
  const pending = unfolded.reduce((state, event) => stepPending(state, event), window.pending)
  const folded = unfolded.reduce(
    (state, event) => stepSessionViewWith({ state, views, event }),
    window.view,
  )
  const failureMessage = unfolded.reduce(stepFailureMessage, window.failureMessage)
  const visible = visibleWithin({ state: visibility, events: [...window.events, ...events] }).slice(
    -(args.renderLimit ?? RENDER_LIMIT),
  )
  const durable = [...window.durable, ...events.filter((event) => isDurable(event.type))]
  const foldable = foldableOf({ visible, durable })
  return {
    window: {
      events: visible,
      visibility,
      pending,
      view: unfolded.some(needsRebuild)
        ? rebuildEditSensitive({ state: folded, visibleTail: visible, foldableTail: foldable })
        : folded,
      failureMessage,
      durable,
      foldable,
      commandLog: [...window.commandLog, ...events.filter(isCommandLogEvent)],
      quickStopRows: [...window.quickStopRows, ...events.filter(isQuickStopEvidenceRow)],
      cursor: cursorAfter({ page, last }),
      foldedThrough: window.foldedThrough,
    },
    fresh: events,
    skipped,
    issue,
  }
}

export const applyPage = (args: {
  window: SessionWindow
  page: EventsPage
  eventSchema?: z.ZodType<V2Event> | undefined
}): SessionWindow => applyPageOutcome(args).window
