export enum EAuthState {
  Loading = 'loading',
  SignedOut = 'signed-out',
  SigningIn = 'signing-in',
  SignedIn = 'signed-in',
  Failed = 'failed',
}

export interface IAuthUser {
  email: string
  name?: string
}

export interface IAuthSnapshot {
  state: EAuthState
  token?: string
  user?: IAuthUser
  error?: string
}

export enum EAuthEvent {
  RestoreMissing = 'restore-missing',
  RestoreSucceeded = 'restore-succeeded',
  RestoreFailed = 'restore-failed',
  BeginSignIn = 'begin-sign-in',
  SignInCancelled = 'sign-in-cancelled',
  SignInSucceeded = 'sign-in-succeeded',
  SignInFailed = 'sign-in-failed',
  SessionLost = 'session-lost',
  SignOut = 'sign-out',
}

export type TAuthEvent =
  | { type: EAuthEvent.RestoreMissing }
  | { type: EAuthEvent.RestoreSucceeded; token: string; user: IAuthUser }
  | { type: EAuthEvent.RestoreFailed }
  | { type: EAuthEvent.BeginSignIn }
  | { type: EAuthEvent.SignInCancelled }
  | { type: EAuthEvent.SignInSucceeded; token: string; user: IAuthUser }
  | { type: EAuthEvent.SignInFailed; error: string }
  | { type: EAuthEvent.SessionLost }
  | { type: EAuthEvent.SignOut }

export const initialAuthSnapshot: IAuthSnapshot = { state: EAuthState.Loading }

export const authReducer = (snapshot: IAuthSnapshot, event: TAuthEvent): IAuthSnapshot => {
  switch (event.type) {
    case EAuthEvent.RestoreMissing:
    case EAuthEvent.RestoreFailed:
    case EAuthEvent.SessionLost:
    case EAuthEvent.SignOut:
      return { state: EAuthState.SignedOut }
    case EAuthEvent.RestoreSucceeded:
    case EAuthEvent.SignInSucceeded:
      return { state: EAuthState.SignedIn, token: event.token, user: event.user }
    case EAuthEvent.BeginSignIn:
      return snapshot.state === EAuthState.SignedOut || snapshot.state === EAuthState.Failed
        ? { state: EAuthState.SigningIn }
        : snapshot
    case EAuthEvent.SignInCancelled:
      return snapshot.state === EAuthState.SigningIn ? { state: EAuthState.SignedOut } : snapshot
    case EAuthEvent.SignInFailed:
      return snapshot.state === EAuthState.SigningIn
        ? { state: EAuthState.Failed, error: event.error }
        : snapshot
  }
}
