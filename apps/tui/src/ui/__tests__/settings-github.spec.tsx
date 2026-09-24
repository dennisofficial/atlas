import { describe, expect, it } from 'bun:test'
import React from 'react'

import { DOWNLOAD_LABEL, ECloudAction, SettingsCloud, idleSync } from '../components/settings/cloud'
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

const cloud = (over: {
  signedIn?: boolean
  action?: ECloudAction
  github?: Partial<GithubAccountView>
}): React.ReactNode => (
  <SettingsCloud
    cells={WIDTH}
    email={over.signedIn === false ? null : 'dev@example.com'}
    signedIn={over.signedIn ?? true}
    action={over.action ?? ECloudAction.SignOut}
    onSignOut={() => undefined}
    onUpload={() => undefined}
    onDownload={() => undefined}
    upload={idleSync()}
    download={idleSync()}
    cloudSignIn={idleLogin()}
    onSignIn={() => undefined}
    onOpenSignInUrl={() => undefined}
    github={githubView(over.github ?? {})}
  />
)

describe('the GitHub row on the cloud settings page', () => {
  it('stays away entirely when signed out of Atlas Cloud', async () => {
    const frame = await frameOf(cloud({ signedIn: false }), WIDTH)

    expect(frame).not.toContain('GitHub')
  })

  it('offers connect when signed in but not connected', async () => {
    const frame = await frameOf(cloud({}), WIDTH)

    expect(frame).toContain('not connected')
    expect(frame).toContain('⏎ to connect')
  })

  it('shows the login and a disconnect affordance when connected', async () => {
    const frame = await frameOf(
      cloud({ github: { connection: { login: 'octocat' } } }),
      WIDTH,
    )

    expect(frame).toContain('@octocat')
    expect(frame).toContain('connected')
    expect(frame).toContain('⏎ to disconnect')
  })

  it('says when Atlas Cloud cannot be reached', async () => {
    const frame = await frameOf(cloud({ github: { unreachable: true } }), WIDTH)

    expect(frame).toContain("couldn't reach Atlas Cloud")
  })

  it('shows the device code and verification URL while prompting', async () => {
    const frame = await frameOf(
      cloud({
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
      cloud({
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
      cloud({ github: { flow: failedLogin('that connection was refused.') } }),
      WIDTH,
    )

    expect(frame).toContain('that connection was refused.')
  })

  it('sits below the download row when signed in', async () => {
    const rows = (await frameOf(cloud({}), WIDTH)).split('\n')
    const download = rows.findIndex((row) => row.includes(DOWNLOAD_LABEL))
    const github = rows.findIndex((row) => row.includes('GitHub'))

    expect(download).toBeGreaterThanOrEqual(0)
    expect(github).toBeGreaterThan(download)
  })
})
