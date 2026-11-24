import { describe, expect, it } from 'bun:test'

import { EAuthState } from '../../auth/auth-reducer'
import { EIdentityAction, identityStepOf } from '../identity-action'

const user = { id: 'user-1', email: 'd@x.io' }

describe('identityStepOf', () => {
  it('identifies a signed-in user once', () => {
    expect(identityStepOf({ identifiedId: undefined, state: EAuthState.SignedIn, user })).toEqual({
      action: EIdentityAction.Identify,
      userId: 'user-1',
      email: 'd@x.io',
    })
    expect(identityStepOf({ identifiedId: 'user-1', state: EAuthState.SignedIn, user })).toEqual({
      action: EIdentityAction.None,
    })
  })

  it('identifies again when a different user signs in', () => {
    expect(
      identityStepOf({ identifiedId: 'user-0', state: EAuthState.SignedIn, user }).action,
    ).toBe(EIdentityAction.Identify)
  })

  it('resets only after an identified user signs out', () => {
    expect(
      identityStepOf({ identifiedId: 'user-1', state: EAuthState.SignedOut, user: undefined }),
    ).toEqual({ action: EIdentityAction.Reset })
    expect(
      identityStepOf({ identifiedId: undefined, state: EAuthState.SignedOut, user: undefined }),
    ).toEqual({ action: EIdentityAction.None })
  })

  it('does nothing while loading or signing in', () => {
    for (const state of [EAuthState.Loading, EAuthState.SigningIn, EAuthState.Failed]) {
      expect(identityStepOf({ identifiedId: 'user-1', state, user: undefined }).action).toBe(
        EIdentityAction.None,
      )
    }
  })
})
