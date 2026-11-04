export enum EHeldAction {
  AbortTurn = 'abort-turn',
  ConsumeStop = 'consume-stop',
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
}

export const decideHeldAction = (snapshot: HeldSnapshot): EHeldAction => {
  if (snapshot.draining) return EHeldAction.Wait
  if (snapshot.stopPending) {
    return snapshot.turn === 'running' ? EHeldAction.AbortTurn : EHeldAction.ConsumeStop
  }
  if (snapshot.turn === 'running') return EHeldAction.Wait
  if (snapshot.messagePending) return EHeldAction.StartTurn
  if (snapshot.idleDue) return EHeldAction.Release
  return EHeldAction.Wait
}
