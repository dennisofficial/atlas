import { describe, expect, it } from 'bun:test'

import {
  authReducer,
  EAuthEvent,
  EAuthState,
  initialAuthSnapshot,
  type IAuthSnapshot,
} from '../auth-reducer'

const signedOut: IAuthSnapshot = { state: EAuthState.SignedOut }
const signingIn: IAuthSnapshot = { state: EAuthState.SigningIn }
const signedIn: IAuthSnapshot = {
  state: EAuthState.SignedIn,
  token: 't',
  user: { email: 'd@x.io' },
}

describe('authReducer', () => {
  it('moves from loading to signed-out when no token is stored', () => {
    expect(authReducer(initialAuthSnapshot, { type: EAuthEvent.RestoreMissing })).toEqual(signedOut)
  })

  it('clears a stale stored token on a failed restore', () => {
    expect(authReducer(initialAuthSnapshot, { type: EAuthEvent.RestoreFailed })).toEqual(signedOut)
  })

  it('restores a verified session', () => {
    const next = authReducer(initialAuthSnapshot, {
      type: EAuthEvent.RestoreSucceeded,
      token: 't',
      user: { email: 'd@x.io' },
    })
    expect(next).toEqual(signedIn)
  })

  it('begins sign-in only from signed-out or failed', () => {
    expect(authReducer(signedOut, { type: EAuthEvent.BeginSignIn })).toEqual(signingIn)
    expect(authReducer({ state: EAuthState.Failed }, { type: EAuthEvent.BeginSignIn })).toEqual(
      signingIn,
    )
    expect(authReducer(signedIn, { type: EAuthEvent.BeginSignIn })).toBe(signedIn)
    expect(authReducer(initialAuthSnapshot, { type: EAuthEvent.BeginSignIn })).toBe(
      initialAuthSnapshot,
    )
  })

  it('returns to signed-out when sign-in is cancelled', () => {
    expect(authReducer(signingIn, { type: EAuthEvent.SignInCancelled })).toEqual(signedOut)
    expect(authReducer(signedOut, { type: EAuthEvent.SignInCancelled })).toBe(signedOut)
  })

  it('fails with an error message only while signing in', () => {
    expect(authReducer(signingIn, { type: EAuthEvent.SignInFailed, error: 'nope' })).toEqual({
      state: EAuthState.Failed,
      error: 'nope',
    })
    expect(authReducer(signedOut, { type: EAuthEvent.SignInFailed, error: 'nope' })).toBe(signedOut)
  })

  it('signs in with token and user', () => {
    expect(
      authReducer(signingIn, {
        type: EAuthEvent.SignInSucceeded,
        token: 't2',
        user: { email: 'd@x.io' },
      }),
    ).toEqual({ state: EAuthState.SignedIn, token: 't2', user: { email: 'd@x.io' } })
  })

  it('returns to signed-out on session loss and sign-out', () => {
    expect(authReducer(signedIn, { type: EAuthEvent.SessionLost })).toEqual(signedOut)
    expect(authReducer(signedIn, { type: EAuthEvent.SignOut })).toEqual(signedOut)
  })
})
