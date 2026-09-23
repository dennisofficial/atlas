import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EAccountAction, SettingsAccount } from '../components/settings/account'
import type { GithubAccountView } from '../components/settings/github-connect'
import { idleLogin, promptingLogin, signedInLogin, failedLogin } from '../settings-login-model'
import { frameOf } from './transcript-fixture'

const WIDTH = 80

const githubView = (over: Partial<GithubAccountView>): GithubAccountView => ({
  connection: null,
  unreachable: false,
  flow: idleLogin(),
  onActivate: () => undefined,
  onOpenUrl: () => undefined,
  ...over,
})

const account = (over: {
  signedIn?: boolean
  action?: EAccountAction
  github?: Partial<GithubAccountView>
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
    github={githubView(over.github ?? {})}
  />
)

describe('the GitHub row on the account settings page', () => {
  it('points at cloud sign-in when signed out of Atlas Cloud', async () => {
    const frame = await frameOf(account({ signedIn: false }), WIDTH)

    expect(frame).toContain('GitHub')
    expect(frame).toContain('sign in to Atlas Cloud first')
  })

  it('offers connect when signed in but not connected', async () => {
    const frame = await frameOf(account({}), WIDTH)

    expect(frame).toContain('not connected')
    expect(frame).toContain('⏎ to connect')
  })

  it('shows the login and a disconnect affordance when connected', async () => {
    const frame = await frameOf(
      account({ github: { connection: { login: 'octocat' } } }),
      WIDTH,
    )

    expect(frame).toContain('@octocat')
    expect(frame).toContain('connected')
    expect(frame).toContain('⏎ to disconnect')
  })

  it('says when Atlas Cloud cannot be reached', async () => {
    const frame = await frameOf(account({ github: { unreachable: true } }), WIDTH)

    expect(frame).toContain("couldn't reach Atlas Cloud")
  })

  it('shows the device code and verification URL while prompting', async () => {
    const frame = await frameOf(
      account({
        github: {
          flow: promptingLogin({ url: 'https://github.com/login/device', userCode: 'ABCD-1234' }),
        },
      }),
      WIDTH,
    )

    expect(frame).toContain('ABCD-1234')
    expect(frame).toContain('https://github.com/login/device')
  })

  it('surfaces the connected notice under the row', async () => {
    const frame = await frameOf(
      account({
        github: {
          connection: { login: 'octocat' },
          flow: signedInLogin('Connected GitHub as @octocat.'),
        },
      }),
      WIDTH,
    )

    expect(frame).toContain('Connected GitHub as @octocat.')
  })

  it('surfaces a refusal as failure text', async () => {
    const frame = await frameOf(
      account({ github: { flow: failedLogin('that connection was refused.') } }),
      WIDTH,
    )

    expect(frame).toContain('that connection was refused.')
  })

  it('sits below the download & purge row when signed in', async () => {
    const rows = (await frameOf(account({}), WIDTH)).split('\n')
    const purge = rows.findIndex((row) => row.includes('Download & purge cloud data'))
    const github = rows.findIndex((row) => row.includes('GitHub'))

    expect(purge).toBeGreaterThanOrEqual(0)
    expect(github).toBeGreaterThan(purge)
  })
})
