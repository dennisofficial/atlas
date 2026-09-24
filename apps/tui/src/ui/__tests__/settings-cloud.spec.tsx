import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  DOWNLOAD_LABEL,
  ECloudAction,
  SettingsCloud,
  UPLOAD_LABEL,
  idleSync,
  type CloudSyncState,
} from '../components/settings/cloud'
import type { GithubAccountView } from '../components/settings/github-connect'
import { idleLogin } from '../settings-login-model'
import { frameOf } from './transcript-fixture'

const WIDTH = 80

const githubView = (): GithubAccountView => ({
  connection: null,
  unreachable: false,
  flow: idleLogin(),
  onActivate: () => undefined,
  onOpenUrl: () => undefined,
})

const cloud = (over: {
  signedIn?: boolean
  action?: ECloudAction | null
  upload?: CloudSyncState
  download?: CloudSyncState
  github?: boolean
}): React.ReactNode => (
  <SettingsCloud
    cells={WIDTH}
    email={over.signedIn === false ? null : 'dev@example.com'}
    signedIn={over.signedIn ?? true}
    action={over.action === undefined ? ECloudAction.SignOut : over.action}
    onSignOut={() => undefined}
    onUpload={() => undefined}
    onDownload={() => undefined}
    upload={over.upload ?? idleSync()}
    download={over.download ?? idleSync()}
    cloudSignIn={idleLogin()}
    onSignIn={() => undefined}
    onOpenSignInUrl={() => undefined}
    {...(over.github === false ? {} : { github: githubView() })}
  />
)

describe('the cloud settings rows', () => {
  it('offers all four actions in order when signed in', async () => {
    const rows = (await frameOf(cloud({}), WIDTH)).split('\n')
    const signOut = rows.findIndex((row) => row.includes('Sign out'))
    const upload = rows.findIndex((row) => row.includes(UPLOAD_LABEL))
    const download = rows.findIndex((row) => row.includes(DOWNLOAD_LABEL))
    const github = rows.findIndex((row) => row.includes('GitHub'))

    expect(signOut).toBeGreaterThanOrEqual(0)
    expect(upload).toBeGreaterThan(signOut)
    expect(download).toBeGreaterThan(upload)
    expect(github).toBeGreaterThan(download)
  })

  it('shows only the sign-in row when signed out', async () => {
    const frame = await frameOf(cloud({ signedIn: false }), WIDTH)

    expect(frame).toContain('not signed in')
    expect(frame).toContain('Sign in')
    expect(frame).not.toContain('Sign out')
    expect(frame).not.toContain(UPLOAD_LABEL)
    expect(frame).not.toContain(DOWNLOAD_LABEL)
    expect(frame).not.toContain('GitHub')
  })

  it('marks the selected action and only that action', async () => {
    const selected = await frameOf(cloud({ action: ECloudAction.Upload }), WIDTH)
    const rows = selected.split('\n').filter((row) => row.includes('❯'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain(UPLOAD_LABEL)
  })

  it('marks no action while the cursor sits on the setting rows', async () => {
    const frame = await frameOf(cloud({ action: null }), WIDTH)
    const rows = frame.split('\n').filter((row) => row.includes('❯'))

    expect(rows).toHaveLength(0)
  })

  it('reads out the upload feedback under its row', async () => {
    const frame = await frameOf(
      cloud({ upload: { running: false, notice: 'Uploaded 2 accounts, 1 secret and 0 mcp servers to the cloud.', failure: null } }),
      WIDTH,
    )

    expect(frame).toContain('Uploaded 2 accounts, 1 secret and 0 mcp servers to the cloud.')
  })

  it('reads out a download failure under its row', async () => {
    const frame = await frameOf(
      cloud({ download: { running: false, notice: null, failure: 'the cloud refused' } }),
      WIDTH,
    )

    expect(frame).toContain('the cloud refused')
  })

  it('says while a sync is running', async () => {
    const frame = await frameOf(
      cloud({ upload: { running: true, notice: null, failure: null } }),
      WIDTH,
    )

    expect(frame).toContain('uploading…')
  })
})
