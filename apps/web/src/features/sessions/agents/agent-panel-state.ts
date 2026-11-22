import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

export enum EAgentPanelState {
  Error = 'error',
  Loading = 'loading',
  Ready = 'ready',
}

export const agentPanelStateOf = (
  snapshot: Pick<SessionSnapshot, 'events' | 'error' | 'connection'>,
): EAgentPanelState => {
  if (snapshot.error !== undefined) return EAgentPanelState.Error
  if (snapshot.events.length === 0 && snapshot.connection !== ESessionConnection.Live) {
    return EAgentPanelState.Loading
  }
  return EAgentPanelState.Ready
}
