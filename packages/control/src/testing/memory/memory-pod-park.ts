import type { State } from './memory-state'

export const parkPodIn = (params: {
  state: State
  sessionId: string
  at: string
}): { parkedAt: string } => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined) throw new Error(`unknown session ${params.sessionId}`)
  row.podParkedAt = params.at
  row.podParkError = null
  return { parkedAt: params.at }
}

export const failPodParkIn = (params: {
  state: State
  sessionId: string
  parkedAt: string
  error: string
}): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined || row.podParkedAt !== params.parkedAt) return false
  row.podParkError = params.error
  return true
}

export const clearPodParkIn = (params: { state: State; sessionId: string }): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined) return false
  if (row.podParkedAt === null && row.podParkError === null) return false
  row.podParkedAt = null
  row.podParkError = null
  return true
}
