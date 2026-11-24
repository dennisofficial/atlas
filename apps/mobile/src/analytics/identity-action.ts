import { EAuthState, type IAuthUser } from '../auth/auth-reducer'

export enum EIdentityAction {
  None = 'none',
  Identify = 'identify',
  Reset = 'reset',
}

export type TIdentityStep =
  | { action: EIdentityAction.None }
  | { action: EIdentityAction.Identify; userId: string; email: string }
  | { action: EIdentityAction.Reset }

export const identityStepOf = (args: {
  identifiedId: string | undefined
  state: EAuthState
  user: IAuthUser | undefined
}): TIdentityStep => {
  const { identifiedId, state, user } = args
  if (state === EAuthState.SignedIn && user !== undefined) {
    if (identifiedId === user.id) return { action: EIdentityAction.None }
    return { action: EIdentityAction.Identify, userId: user.id, email: user.email }
  }
  if (state === EAuthState.SignedOut && identifiedId !== undefined) {
    return { action: EIdentityAction.Reset }
  }
  return { action: EIdentityAction.None }
}
