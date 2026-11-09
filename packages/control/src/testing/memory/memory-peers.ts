import type { State } from './memory-state'

export const claimPeerMessageIn = (params: {
  state: State
  sessionId: string
  budget: number
}): number | null => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined || row.peerMessagesSent >= params.budget) return null
  row.peerMessagesSent += 1
  return row.peerMessagesSent
}

export const resetPeerMessagesIn = (params: { state: State; sessionId: string }): boolean => {
  const row = params.state.sessions.get(params.sessionId)
  if (row === undefined) return false
  row.peerMessagesSent = 0
  return true
}

export const podPeersPlacedIn = (params: {
  state: State
  podSessionId: string
  excludeSessionId: string
}): number =>
  [...params.state.sessions.values()].filter(
    (row) =>
      (row.podSessionId ?? row.sessionId) === params.podSessionId &&
      row.sessionId !== params.excludeSessionId,
  ).length
