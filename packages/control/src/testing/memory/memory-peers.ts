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
