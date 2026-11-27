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
  commandPending: boolean
  parked: boolean
  resumable: boolean
  idleDue: boolean
  workspace: EWorkspaceState
  preparedBefore: boolean
  retryPending: boolean
}

const afterFailure = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.retryPending) return EHeldAction.Prepare
  return snapshot.idleDue ? EHeldAction.Release : EHeldAction.Wait
}

const prepared = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.messagePending || snapshot.resumable) return EHeldAction.StartTurn
  if (snapshot.commandPending) return EHeldAction.Wait
  return snapshot.idleDue ? EHeldAction.Release : EHeldAction.Wait
}

const preparing = (snapshot: HeldSnapshot): EHeldAction => {
  const wanted = snapshot.messagePending || snapshot.resumable
  return snapshot.preparedBefore && wanted ? EHeldAction.StartTurn : EHeldAction.Wait
}

export const decideHeldAction = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.draining) return EHeldAction.Wait
  if (snapshot.stopPending) {
    return snapshot.turn === 'running' ? EHeldAction.AbortTurn : EHeldAction.ConsumeStop
  }
  if (snapshot.turn === 'running') return EHeldAction.Wait
  if (snapshot.parked && !snapshot.messagePending && !snapshot.commandPending)
    return EHeldAction.Release
  switch (snapshot.workspace) {
    case EWorkspaceState.Unprepared:
      return EHeldAction.Prepare
    case EWorkspaceState.Preparing:
      return preparing(snapshot)
    case EWorkspaceState.Failed:
      return afterFailure(snapshot)
    case EWorkspaceState.Prepared:
      return prepared(snapshot)
  }
}

export type DrainSnapshot = {
  turn: 'idle' | 'running'
  parked: boolean
  childrenRunning: boolean
  shellsOpen: boolean
  resumable: boolean
  messagePending: boolean
  commandPending: boolean
  workspace: EWorkspaceState
  retryPending: boolean
}

export const drainWantsHolder = (snapshot: DrainSnapshot): boolean => {
  if (snapshot.turn === 'running' || snapshot.messagePending || snapshot.commandPending) return true
  if (snapshot.parked) return false
  if (snapshot.childrenRunning || snapshot.shellsOpen || snapshot.resumable) return true
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
