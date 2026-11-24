import type { PodPlacedSession } from '../../port'
import type { State } from './memory-state'

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

export const podSessionsPlacedIn = (params: {
  state: State
  podSessionId: string
}): PodPlacedSession[] =>
  [...params.state.sessions.values()]
    .filter((row) => (row.podSessionId ?? row.sessionId) === params.podSessionId)
    .map((row) => ({ sessionId: row.sessionId, archivedAt: row.archivedAt }))
