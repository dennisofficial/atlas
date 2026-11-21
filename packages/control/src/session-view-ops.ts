import {
  isSurviving,
  needsRebuild,
  rebuildEditSensitive,
  initialSessionViewState,
  refoldRewindable,
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
import { decodeVisibility } from './stored-event'

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
}): { state: SessionViewState; rebuild: boolean; rewound: boolean } => {
  const views = args.pluginViews ?? []
  let state = args.state
  let rebuild = false
  let rewound = false
  for (const event of args.events) {
    state = stepSessionView(state, event)
    if (views.length > 0) {
      state = { ...state, pluginViews: foldPluginViews({ bag: state.pluginViews, views, event }) }
    }
    rebuild ||= needsRebuild(event)
    rewound ||= event.type === 'history-rewound'
  }
  return { state, rebuild, rewound }
}

const survivingEvents = async (args: {
  tx: ControlTx
  row: ThreadRow
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<V2Event[]> => {
  const visibility = decodeVisibility(args.row.visibility)
  const surviving: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await readEventsIn({
      tx: args.tx,
      row: args.row,
      afterSeq,
      limit: CATCH_UP_PAGE,
      visible: false,
      eventSchema: args.eventSchema,
    })
    surviving.push(...page.events.filter((event) => isSurviving(visibility, event)))
    if (page.next === undefined) return surviving
    afterSeq = page.next
  }
}

export const rebuildFromLog = async (args: {
  tx: ControlTx
  row: ThreadRow
  state: SessionViewState
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
  rewound: boolean
}): Promise<SessionViewState> => {
  const tail = await readEventsIn({
    tx: args.tx,
    row: args.row,
    afterSeq: Math.max(0, args.row.headSeq - VIEW_TAIL_LIMIT),
    limit: VIEW_TAIL_LIMIT,
    visible: true,
    eventSchema: args.eventSchema,
  })
  const rebuilt = rebuildEditSensitive({ state: args.state, visibleTail: tail.events })
  const views = args.pluginViews ?? []
  if (!args.rewound || views.length === 0) return rebuilt
  const surviving = await survivingEvents({
    tx: args.tx,
    row: args.row,
    eventSchema: args.eventSchema,
  })
  return {
    ...rebuilt,
    pluginViews: refoldRewindable({ bag: rebuilt.pluginViews, views, surviving }),
  }
}

export const branchRowsOf = (args: {
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

export const catchUpSessionViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  row: ThreadRow
  existing: SessionViewRow | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<SessionViewState> => {
  const { tx, sessionId, row } = args
  const existing = usableState(args.existing)
  if (existing !== undefined && existing.at >= row.headSeq) return existing

  let state = existing ?? initialSessionViewState
  let rebuild = false
  let rewound = false
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
    rewound ||= next.rewound
    folded = [...folded, ...page.events]
    if (page.next === undefined) break
  }
  if (rebuild)
    state = await rebuildFromLog({
      tx,
      row,
      state,
      eventSchema: args.eventSchema,
      pluginViews: args.pluginViews,
      rewound,
    })
  await persistIn({
    tx,
    sessionId,
    threadId: row.threadId,
    state,
    branches: branchRowsOf({ sessionId, events: folded }),
  })
  return state
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
  const state = await catchUpSessionViewIn({
    tx,
    sessionId,
    row,
    existing: await tx.readSessionView(sessionId),
    eventSchema: args.eventSchema,
    pluginViews: args.pluginViews,
  })
  return { row, state }
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
    ? await rebuildFromLog({
        tx,
        row,
        state: folded.state,
        eventSchema: args.eventSchema,
        pluginViews: args.pluginViews,
        rewound: folded.rewound,
      })
    : folded.state
  await persistIn({
    tx,
    sessionId: args.sessionId,
    threadId: row.threadId,
    state,
    branches: branchRowsOf({ sessionId: args.sessionId, events: args.events }),
  })
}
