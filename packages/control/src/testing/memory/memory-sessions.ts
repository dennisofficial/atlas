import type { ControlSessionRow } from '../../port'
import type { State } from './memory-state'

const publicRow = (row: State['sessions'] extends Map<string, infer R> ? R : never) => {
  const { nextInboxId: _nextInboxId, ...session } = row
  return { ...session }
}

export const readSessionIn = (params: {
  state: State
  sessionId: string
}): ControlSessionRow | undefined => {
  const row = params.state.sessions.get(params.sessionId)
  return row === undefined ? undefined : publicRow(row)
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
}): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined || row.title !== null) return false
  row.title = params.title
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
    .map(publicRow)
