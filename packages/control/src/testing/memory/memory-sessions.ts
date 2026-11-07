import type { ControlSessionRow } from '../../port'
import { sessionRowOf, type State } from './memory-state'

export const readSessionIn = (params: {
  state: State
  sessionId: string
}): ControlSessionRow | undefined => {
  const row = params.state.sessions.get(params.sessionId)
  return row === undefined ? undefined : sessionRowOf(row)
}

export const setSessionArchivedIn = (params: {
  state: State
  sessionId: string
  archivedAt: string | null
}): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined) return false
  row.archivedAt = params.archivedAt
  return true
}

export const setSessionTitleIfUntitledIn = (params: {
  state: State
  sessionId: string
  title: string
  fromInboxId: number | null
}): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined || row.title !== null) return false
  row.title = params.title
  row.titledFromInboxId = params.fromInboxId
  return true
}

export const clearTitleFromIn = (params: {
  state: State
  sessionId: string
  inboxId: number
}): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined || row.titledFromInboxId !== params.inboxId) return false
  row.title = null
  row.titledFromInboxId = null
  return true
}

export const listSessionsIn = (params: {
  state: State
  userId: string
  projectId?: string | undefined
  limit: number
}): ControlSessionRow[] =>
  [...params.state.sessions.values()]
    .filter((row) => row.userId === params.userId)
    .filter((row) => params.projectId === undefined || row.projectId === params.projectId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, params.limit)
    .map(sessionRowOf)

export const createSessionIn = (params: {
  state: State
  sessionId: string
  userId: string
  projectId: string
  title?: string | undefined
  mainThreadId: string
  at: string
}): void => {
  const { state } = params
  if (state.sessions.has(params.sessionId)) throw new Error('session exists')
  state.sessions.set(params.sessionId, {
    sessionId: params.sessionId,
    userId: params.userId,
    projectId: params.projectId,
    title: params.title ?? null,
    mainThreadId: params.mainThreadId,
    createdAt: params.at,
    archivedAt: null,
    nextInboxId: 1,
    titledFromInboxId: null,
  })
  state.leases.set(params.sessionId, {
    sessionId: params.sessionId,
    epoch: 0,
    holderHostId: null,
    wantsHolder: false,
    attempts: 0,
    retryAfter: null,
  })
}
