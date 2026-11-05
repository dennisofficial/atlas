import { EWorkspaceState } from '../record/workspace'

export enum EHeldAction {
  AbortTurn = 'abort-turn',
  ConsumeStop = 'consume-stop',
  Prepare = 'prepare',
  StartTurn = 'start-turn',
  Release = 'release',
  Wait = 'wait',
}

export type HeldSnapshot = {
  draining: boolean
  turn: 'idle' | 'running'
  stopPending: boolean
  messagePending: boolean
  idleDue: boolean
  workspace: EWorkspaceState
  retryPending: boolean
}

const afterFailure = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.retryPending) return EHeldAction.Prepare
  return snapshot.idleDue ? EHeldAction.Release : EHeldAction.Wait
}

const prepared = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.messagePending) return EHeldAction.StartTurn
  return snapshot.idleDue ? EHeldAction.Release : EHeldAction.Wait
}

export const decideHeldAction = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.draining) return EHeldAction.Wait
  if (snapshot.stopPending) {
    return snapshot.turn === 'running' ? EHeldAction.AbortTurn : EHeldAction.ConsumeStop
  }
  if (snapshot.turn === 'running') return EHeldAction.Wait
  switch (snapshot.workspace) {
    case EWorkspaceState.Unprepared:
      return EHeldAction.Prepare
    case EWorkspaceState.Preparing:
      return EHeldAction.Wait
    case EWorkspaceState.Failed:
      return afterFailure(snapshot)
    case EWorkspaceState.Prepared:
      return prepared(snapshot)
  }
}

export type DrainSnapshot = {
  turn: 'idle' | 'running'
  resumable: boolean
  messagePending: boolean
  workspace: EWorkspaceState
  retryPending: boolean
}

export const drainWantsHolder = (snapshot: DrainSnapshot): boolean => {
  if (snapshot.turn === 'running' || snapshot.resumable || snapshot.messagePending) return true
  switch (snapshot.workspace) {
    case EWorkspaceState.Unprepared:
    case EWorkspaceState.Preparing:
      return true
    case EWorkspaceState.Failed:
      return snapshot.retryPending
    case EWorkspaceState.Prepared:
      return false
  }
}
