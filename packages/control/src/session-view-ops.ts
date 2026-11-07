import {
  needsRebuild,
  normalizedPrRepo,
  rebuildEditSensitive,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  stepSessionView,
  type SessionViewState,
  type V2Event,
} from '@dltech/atlas-core'

import { UnknownThreadError } from './errors'
import type { ControlTx, SessionPullRequestRow, SessionViewRow, ThreadRow } from './port'
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

export const foldEvents = (args: {
  state: SessionViewState
  events: readonly V2Event[]
}): { state: SessionViewState; rebuild: boolean } => {
  let state = args.state
  let rebuild = false
  for (const event of args.events) {
    state = stepSessionView(state, event)
    rebuild ||= needsRebuild(event)
  }
  return { state, rebuild }
}

export const rebuildFromTail = async (args: {
  tx: ControlTx
  row: ThreadRow
  state: SessionViewState
}): Promise<SessionViewState> => {
  const tail = await readEventsIn({
    tx: args.tx,
    row: args.row,
    afterSeq: Math.max(0, args.row.headSeq - VIEW_TAIL_LIMIT),
    limit: VIEW_TAIL_LIMIT,
    visible: true,
  })
  return rebuildEditSensitive({ state: args.state, visibleTail: tail.events })
}

const linkRowsOf = (args: {
  sessionId: string
  links: readonly { repo: string; number: number }[]
}): SessionPullRequestRow[] =>
  args.links.map((link) => ({ sessionId: args.sessionId, repo: link.repo, number: link.number }))

const persistIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  state: SessionViewState
  links: readonly { repo: string; number: number }[]
}): Promise<void> => {
  const { tx, state } = args
  await tx.writeSessionView({
    sessionId: args.sessionId,
    threadId: args.threadId,
    atSeq: state.at,
    version: state.version,
    state: encodeViewState(state),
  })
  if (args.links.length === 0) return
  await tx.insertSessionPullRequests(linkRowsOf({ sessionId: args.sessionId, links: args.links }))
}

export const ensureSessionViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
}): Promise<LoadedView> => {
  const { tx, sessionId, threadId } = args
  const row = await tx.readThread(threadId)
  if (row === undefined) throw new UnknownThreadError(threadId)
  const existing = usableState(await tx.readSessionView(sessionId))
  if (existing !== undefined && existing.at >= row.headSeq) return { row, state: existing }

  let state = existing ?? initialSessionViewState
  let rebuild = false
  for (;;) {
    const page = await readEventsIn({
      tx,
      row,
      afterSeq: state.at,
      limit: CATCH_UP_PAGE,
      visible: false,
    })
    const folded = foldEvents({ state, events: page.events })
    state = folded.state
    rebuild ||= folded.rebuild
    if (page.next === undefined) break
  }
  if (rebuild) state = await rebuildFromTail({ tx, row, state })
  await persistIn({ tx, sessionId, threadId, state, links: state.pullRequests.links })
  return { row, state }
}

export const ensureMainThreadViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
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
}): Promise<void> => {
  const { tx, row } = args
  const folded = foldEvents({ state: args.state, events: args.events })
  const state = folded.rebuild
    ? await rebuildFromTail({ tx, row, state: folded.state })
    : folded.state
  const links = args.events.flatMap((event) =>
    event.type === 'pull-request-linked'
      ? [{ repo: normalizedPrRepo(event.repo), number: event.number }]
      : [],
  )
  await persistIn({ tx, sessionId: args.sessionId, threadId: row.threadId, state, links })
}
