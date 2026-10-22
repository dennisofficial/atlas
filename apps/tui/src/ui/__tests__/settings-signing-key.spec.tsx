import { describe, expect, it } from 'vitest'
import React from 'react'

import { ECloudAction, SettingsCloud, idleSync } from '../components/settings/cloud'
import type { GithubAccountView } from '../components/settings/github-connect'
import {
  ESigningKeyView,
  fingerprintTailOf,
  type SigningKeyView,
} from '../components/settings/signing-key-row'
import { idleLogin } from '../settings-login-model'
import { frameOf } from './transcript-fixture'

const WIDTH = 80

const githubView = (connected: boolean): GithubAccountView => ({
  connection: connected ? { login: 'octocat' } : null,
  unreachable: false,
  flow: idleLogin(),
  onActivate: () => undefined,
  onOpenUrl: () => undefined,
})

const cloud = (over: { view: SigningKeyView; githubConnected?: boolean }): React.ReactNode => (
  <SettingsCloud
    cells={WIDTH}
    email="dev@example.com"
    signedIn
    action={ECloudAction.SignOut}
    onSignOut={() => undefined}
    onUpload={() => undefined}
    onDownload={() => undefined}
    upload={idleSync()}
    download={idleSync()}
    cloudSignIn={idleLogin()}
    onSignIn={() => undefined}
    onOpenSignInUrl={() => undefined}
    github={githubView(over.githubConnected ?? true)}
    signingKey={{
      view: over.view,
      activateRotateOrEnable: () => undefined,
      activateRemove: () => undefined,
    }}
  />
)

describe('the commit signing row', () => {
  it('offers enable when no key is registered', async () => {
    const frame = await frameOf(cloud({ view: { state: ESigningKeyView.Absent } }), WIDTH)

    expect(frame).toContain('Commit signing')
    expect(frame).toContain('off · ⏎ to enable')
    expect(frame).not.toContain('Remove signing key')
  })

  it('shows the key tail, a rotate hint and a remove action when registered', async () => {
    const frame = await frameOf(
      cloud({ view: { state: ESigningKeyView.Registered, fingerprintTail: 'CDEFGHIJ' } }),
      WIDTH,
    )

    expect(frame).toContain('on · …CDEFGHIJ · ⏎ to rotate')
    expect(frame).toContain('Remove signing key')
  })

  it('asks for a GitHub reconnect when the scope is missing', async () => {
    const frame = await frameOf(cloud({ view: { state: ESigningKeyView.ScopeMissing } }), WIDTH)

    expect(frame).toContain('reconnect GitHub to enable')
    expect(frame).not.toContain('Remove signing key')
  })

  it('says when Atlas Cloud cannot be reached', async () => {
    const frame = await frameOf(cloud({ view: { state: ESigningKeyView.Unavailable } }), WIDTH)

    expect(frame).toContain("couldn't reach Atlas Cloud")
  })

  it('keeps the remove action while a rotate is in flight', async () => {
    const frame = await frameOf(
      cloud({ view: { state: ESigningKeyView.Busy, fingerprintTail: 'CDEFGHIJ' } }),
      WIDTH,
    )

    expect(frame).toContain('working…')
    expect(frame).toContain('Remove signing key')
  })

  it('stays hidden while GitHub is not connected', async () => {
    const frame = await frameOf(
      cloud({ view: { state: ESigningKeyView.Absent }, githubConnected: false }),
      WIDTH,
    )

    expect(frame).not.toContain('Commit signing')
  })

  it('sits below the GitHub row', async () => {
    const rows = (await frameOf(cloud({ view: { state: ESigningKeyView.Absent } }), WIDTH)).split(
      '\n',
    )
    const github = rows.findIndex((row) => row.includes('GitHub'))
    const signing = rows.findIndex((row) => row.includes('Commit signing'))

    expect(github).toBeGreaterThanOrEqual(0)
    expect(signing).toBeGreaterThan(github)
  })
})

describe('fingerprintTailOf', () => {
  it('takes the last eight characters of the key blob', () => {
    expect(
      fingerprintTailOf({ publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJ atlas@x' }),
    ).toBe('CDEFGHIJ')
  })
})
