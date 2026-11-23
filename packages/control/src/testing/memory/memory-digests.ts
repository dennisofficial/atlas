import { turnEndedSchema } from '@dltech/atlas-core'

import type {
  SessionBucketCountParams,
  SessionBucketCounts,
  SessionDigestRow,
  SessionListParams,
  SessionTurnEnding,
} from '../../port'
import { sessionRowOf, type SessionRow, type State } from './memory-state'

const FIRST_MESSAGE_CHARS = 400

const textOf = (payload: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null || !('text' in parsed)) return null
    return typeof parsed.text === 'string' ? parsed.text.slice(0, FIRST_MESSAGE_CHARS) : null
  } catch {
    return null
  }
}

const firstMessageOf = (params: {
  state: State
  sessionId: string
}): { firstMessageText: string | null; firstMessageAt: string | null } => {
  const first = params.state.inbox
    .get(params.sessionId)
    ?.filter((entry) => entry.kind === 'message')
    .sort((a, b) => a.inboxId - b.inboxId)[0]
  if (first === undefined) return { firstMessageText: null, firstMessageAt: null }
  return {
    firstMessageText: textOf(first.payload),
    firstMessageAt: first.postedAt,
  }
}

const lastEventAtOf = (params: { state: State; threadId: string }): string | null =>
  params.state.events.get(params.threadId)?.at(-1)?.at ?? null

const stampOf = (iso: string | null): number => (iso === null ? Number.NaN : Date.parse(iso))

const matchesArchived = (row: SessionRow): boolean => row.archivedAt !== null

const matchesSearch = (params: {
  state: State
  row: SessionRow
  search: string | undefined
}): boolean => {
  if (params.search === undefined || params.search.length === 0) return true
  const term = params.search.toLowerCase()
  if (params.row.title?.toLowerCase().includes(term) === true) return true
  const { firstMessageText } = firstMessageOf({
    state: params.state,
    sessionId: params.row.sessionId,
  })
  return firstMessageText?.toLowerCase().includes(term) === true
}

const afterOf = (params: {
  row: SessionRow
  after: NonNullable<SessionListParams['after']>
}): boolean => {
  const rowAt = stampOf(params.row.createdAt)
  const afterAt = stampOf(params.after.createdAt)
  if (rowAt !== afterAt) return rowAt < afterAt
  return params.row.sessionId < params.after.sessionId
}

const newestFirst = (left: SessionRow, right: SessionRow): number => {
  const byCreatedAt = stampOf(right.createdAt) - stampOf(left.createdAt)
  if (byCreatedAt !== 0) return byCreatedAt
  if (left.sessionId === right.sessionId) return 0
  return left.sessionId < right.sessionId ? 1 : -1
}

const lastAssistantSeqOf = (params: { state: State; threadId: string }): number =>
  (params.state.events.get(params.threadId) ?? []).reduce(
    (best, event) => (event.type === 'assistant-said' ? Math.max(best, event.seq) : best),
    0,
  )

const headSeqOf = (params: { state: State; threadId: string }): number =>
  (params.state.events.get(params.threadId) ?? []).at(-1)?.seq ?? 0

const lastTurnOf = (params: { state: State; threadId: string }): SessionTurnEnding | null => {
  const last = (params.state.events.get(params.threadId) ?? [])
    .filter((event) => event.type === 'turn-ended')
    .at(-1)
  if (last === undefined) return null
  const parsed = turnEndedSchema.safeParse(JSON.parse(last.canonical))
  if (!parsed.success) return null
  return { seq: last.seq, outcome: parsed.data.outcome, by: parsed.data.by }
}

const ownedSessionsOf = (params: { state: State } & SessionListParams): SessionRow[] =>
  [...params.state.sessions.values()]
    .filter((row) => row.userId === params.userId)
    .filter((row) => row.deletedAt === null)
    .filter((row) => params.projectId === undefined || row.projectId === params.projectId)
    .filter((row) => params.sessionId === undefined || row.sessionId === params.sessionId)
    .filter(
      (row) =>
        params.spawnedBySessionId === undefined ||
        row.spawnedBySessionId === params.spawnedBySessionId,
    )
    .filter((row) => params.archivedOnly !== true || matchesArchived(row))
    .filter((row) => matchesSearch({ state: params.state, row, search: params.search }))
    .filter((row) => params.after === undefined || afterOf({ row, after: params.after }))

export const sessionDigestsIn = (
  params: { state: State } & SessionListParams,
): SessionDigestRow[] =>
  ownedSessionsOf(params)
    .sort(newestFirst)
    .slice(0, params.limit)
    .map((row) => ({
      ...sessionRowOf(row),
      readSeq: row.readSeq,
      lastEventAt: lastEventAtOf({ state: params.state, threadId: row.mainThreadId }),
      lastAssistantSeq: lastAssistantSeqOf({ state: params.state, threadId: row.mainThreadId }),
      headSeq: headSeqOf({ state: params.state, threadId: row.mainThreadId }),
      lastTurn: lastTurnOf({ state: params.state, threadId: row.mainThreadId }),
      ...firstMessageOf({ state: params.state, sessionId: row.sessionId }),
    }))

export const sessionBucketCountsIn = (
  params: { state: State } & SessionBucketCountParams,
): SessionBucketCounts => {
  const rows = [...params.state.sessions.values()]
    .filter((row) => row.userId === params.userId)
    .filter((row) => row.deletedAt === null)
    .filter((row) => matchesSearch({ state: params.state, row, search: params.search }))
  let archived = 0
  for (const row of rows) {
    if (row.archivedAt !== null) archived += 1
  }
  return { archived }
}
