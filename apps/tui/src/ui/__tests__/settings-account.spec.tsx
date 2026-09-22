import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  DOWNLOAD_PURGE_LABEL,
  EAccountAction,
  SettingsAccount,
} from '../components/settings/account'
import { idleLogin } from '../settings-login-model'
import { frameOf } from './transcript-fixture'

const WIDTH = 80

const account = (over: {
  signedIn?: boolean
  action?: EAccountAction
}): React.ReactNode => (
  <SettingsAccount
    cells={WIDTH}
    email={over.signedIn === false ? null : 'dev@example.com'}
    signedIn={over.signedIn ?? true}
    action={over.action ?? EAccountAction.SignOut}
    onSignOut={() => undefined}
    onDownloadPurge={() => undefined}
    cloudSignIn={idleLogin()}
    onSignIn={() => undefined}
    onOpenSignInUrl={() => undefined}
  />
)

describe('the account settings rows', () => {
  it('offers download & purge below sign out when signed in', async () => {
    const rows = (await frameOf(account({}), WIDTH)).split('\n')
    const signOut = rows.findIndex((row) => row.includes('Sign out'))
    const purge = rows.findIndex((row) => row.includes(DOWNLOAD_PURGE_LABEL))

    expect(signOut).toBeGreaterThanOrEqual(0)
    expect(purge).toBeGreaterThan(signOut)
  })

  it('hides the row when signed out', async () => {
    const frame = await frameOf(account({ signedIn: false }), WIDTH)

    expect(frame).not.toContain(DOWNLOAD_PURGE_LABEL)
  })
})
