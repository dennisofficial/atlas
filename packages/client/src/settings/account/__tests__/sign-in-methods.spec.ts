import { describe, expect, it } from 'bun:test'

import {
  ESignInMethodAction,
  ESignInMethodProvider,
  ONLY_METHOD,
  signInMethodRowsOf,
  signInMethodsOf,
} from '../sign-in-methods'

describe('signInMethodsOf', () => {
  it('maps credential and google account rows to their ids', () => {
    expect(
      signInMethodsOf([
        { id: 'acc-1', providerId: 'credential' },
        { id: 'acc-2', providerId: 'google' },
      ]),
    ).toEqual({ google: 'acc-2', password: 'acc-1' })
  })

  it('answers null for a method with no account row', () => {
    expect(signInMethodsOf([{ id: 'acc-2', providerId: 'google' }])).toEqual({
      google: 'acc-2',
      password: null,
    })
  })

  it('ignores providers the settings page does not manage', () => {
    expect(signInMethodsOf([{ id: 'acc-9', providerId: 'github' }])).toEqual({
      google: null,
      password: null,
    })
  })
})

describe('signInMethodRowsOf', () => {
  it('offers a link for google and a setup link for a missing password', () => {
    const rows = signInMethodRowsOf({ methods: { google: null, password: null }, busy: false })
    expect(rows.map((row) => row.provider)).toEqual([
      ESignInMethodProvider.Google,
      ESignInMethodProvider.Password,
    ])
    expect(rows[0]).toMatchObject({
      badge: 'Not linked',
      linked: false,
      action: ESignInMethodAction.Link,
      actionLabel: 'Link Google',
      primary: true,
      disabled: false,
    })
    expect(rows[1]).toMatchObject({
      badge: 'Not set',
      action: ESignInMethodAction.SendSetupLink,
      actionLabel: 'Send setup link',
      primary: false,
    })
  })

  it('offers an unlink and a remove when both methods exist', () => {
    const rows = signInMethodRowsOf({
      methods: { google: 'g', password: 'p' },
      busy: false,
    })
    expect(rows[0]).toMatchObject({
      badge: 'Linked',
      action: ESignInMethodAction.Unlink,
      actionLabel: 'Unlink',
      disabled: false,
    })
    expect(rows[1]).toMatchObject({
      badge: 'Set',
      action: ESignInMethodAction.Remove,
      actionLabel: 'Remove',
      disabled: false,
    })
    expect(rows[0]?.description).toBe('Sign in with your Google account.')
  })

  it('refuses to remove the only method', () => {
    const rows = signInMethodRowsOf({ methods: { google: 'g', password: null }, busy: false })
    expect(rows[0]).toMatchObject({ disabled: true, description: ONLY_METHOD })
    expect(rows[1]?.disabled).toBe(false)
  })

  it('disables every action while one runs', () => {
    const rows = signInMethodRowsOf({ methods: { google: 'g', password: 'p' }, busy: true })
    expect(rows.map((row) => row.disabled)).toEqual([true, true])
  })
})
