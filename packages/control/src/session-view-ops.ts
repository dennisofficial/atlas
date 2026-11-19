import {
  needsRebuild,
  rebuildEditSensitive,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  stepSessionView,
  workedHeadsOf,
  type PluginViewFold,
  type SessionViewState,
  type V2Event,
} from '@dltech/atlas-core'
import type { z } from 'zod'

import { UnknownThreadError } from './errors'
import type { ControlTx, SessionBranchRow, SessionViewRow, ThreadRow } from './port'
import { readEventsIn } from './read-events'
import { decodeViewState, encodeViewState } from './session-view-codec'

export const CATCH_UP_PAGE = 500
export const VIEW_TAIL_LIMIT = 1000

export type LoadedView = { row: ThreadRow; state: SessionViewState }

export const usableState = (view: SessionViewRow | undefined): SessionViewState | undefined => {
  if (view === undefined || view.version !== SESSION_VIEW_VERSION) return undefined
  const state = decodeViewState(view.state)
  if (state === undefined || state.version !== SESSION_VIEW_VERSION) return undefined
  return state.at === view.atSeq ? state : undefined
}

const foldPluginViews = (args: {
  bag: Readonly<Record<string, unknown>>
  views: readonly PluginViewFold[]
  event: V2Event
}): Readonly<Record<string, unknown>> => {
  let bag = args.bag
  for (const view of args.views) {
    const current = Object.hasOwn(bag, view.name) ? bag[view.name] : view.initial
    bag = { ...bag, [view.name]: view.fold(current, args.event) }
  }
  return bag
}

export const foldEvents = (args: {
  state: SessionViewState
  events: readonly V2Event[]
  pluginViews?: readonly PluginViewFold[] | undefined
}): { state: SessionViewState; rebuild: boolean } => {
  const views = args.pluginViews ?? []
  let state = args.state
  let rebuild = false
  for (const event of args.events) {
    state = stepSessionView(state, event)
    if (views.length > 0) {
      state = { ...state, pluginViews: foldPluginViews({ bag: state.pluginViews, views, event }) }
    }
    rebuild ||= needsRebuild(event)
  }
  return { state, rebuild }
}

export const rebuildFromTail = async (args: {
  tx: ControlTx
  row: ThreadRow
  state: SessionViewState
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<SessionViewState> => {
  const tail = await readEventsIn({
    tx: args.tx,
    row: args.row,
    afterSeq: Math.max(0, args.row.headSeq - VIEW_TAIL_LIMIT),
    limit: VIEW_TAIL_LIMIT,
    visible: true,
    eventSchema: args.eventSchema,
  })
  return rebuildEditSensitive({ state: args.state, visibleTail: tail.events })
}

const branchRowsOf = (args: {
  sessionId: string
  events: readonly V2Event[]
}): SessionBranchRow[] =>
  args.events.flatMap((event) =>
    event.type === 'branches-observed'
      ? workedHeadsOf({ observation: event, base: event.base ?? null }).map((head) => ({
          sessionId: args.sessionId,
          headRepo: head.headRepo,
          branch: head.branch,
          firstSeenSeq: event.seq,
          firstSeenAt: event.at,
        }))
      : [],
  )

const persistIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  state: SessionViewState
  branches: readonly SessionBranchRow[]
}): Promise<void> => {
  const { tx, state } = args
  await tx.writeSessionView({
    sessionId: args.sessionId,
    threadId: args.threadId,
    atSeq: state.at,
    version: state.version,
    state: encodeViewState(state),
  })
  if (args.branches.length === 0) return
  await tx.insertSessionBranches(args.branches)
}

export const ensureSessionViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<LoadedView> => {
  const { tx, sessionId, threadId } = args
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const existing = usableState(await tx.readSessionView(sessionId))
  if (existing !== undefined && existing.at >= row.headSeq) return { row, state: existing }

  let state = existing ?? initialSessionViewState
  let rebuild = false
  let folded: V2Event[] = []
  for (;;) {
    const page = await readEventsIn({
      tx,
      row,
      afterSeq: state.at,
      limit: CATCH_UP_PAGE,
      visible: false,
      eventSchema: args.eventSchema,
    })
    const next = foldEvents({ state, events: page.events, pluginViews: args.pluginViews })
    state = next.state
    rebuild ||= next.rebuild
    folded = [...folded, ...page.events]
    if (page.next === undefined) break
  }
  if (rebuild) state = await rebuildFromTail({ tx, row, state, eventSchema: args.eventSchema })
  await persistIn({
    tx,
    sessionId,
    threadId,
    state,
    branches: branchRowsOf({ sessionId, events: folded }),
  })
  return { row, state }
}

export const ensureMainThreadViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<LoadedView | undefined> => {
  const session = await args.tx.readSession({ sessionId: args.sessionId })
  if (session?.mainThreadId !== args.threadId) return undefined
  return ensureSessionViewIn(args)
}

export const appendToViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  row: ThreadRow
  state: SessionViewState
  events: readonly V2Event[]
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<void> => {
  const { tx, row } = args
  const folded = foldEvents({
    state: args.state,
    events: args.events,
    pluginViews: args.pluginViews,
  })
  const state = folded.rebuild
    ? await rebuildFromTail({ tx, row, state: folded.state, eventSchema: args.eventSchema })
    : folded.state
  await persistIn({
    tx,
    sessionId: args.sessionId,
    threadId: row.threadId,
    state,
    branches: branchRowsOf({ sessionId: args.sessionId, events: args.events }),
  })
}
