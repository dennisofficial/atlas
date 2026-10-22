import { afterEach, describe, expect, it } from 'bun:test'
import { KeyEvent } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { act, useState } from 'react'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { ECloudAction } from '../../ui/components/settings/cloud'
import { ESettingsLogin } from '../../ui/settings-login-model'
import { cloudActionsOf, useCloudPage, type CloudPageControl } from '../use-cloud-page'
import { cloudOf, remote, removeDirectories } from './use-signing-key-fixture'

afterEach(removeDirectories)

describe('cloudActionsOf', () => {
  it('stops at GitHub while GitHub is not connected', () => {
    expect(cloudActionsOf({ githubConnected: false, signingKeyRegistered: false })).toEqual([
      ECloudAction.SignOut,
      ECloudAction.Upload,
      ECloudAction.Download,
      ECloudAction.Github,
    ])
  })

  it('adds the signing key row once GitHub is connected', () => {
    expect(cloudActionsOf({ githubConnected: true, signingKeyRegistered: false })).toEqual([
      ECloudAction.SignOut,
      ECloudAction.Upload,
      ECloudAction.Download,
      ECloudAction.Github,
      ECloudAction.SigningKey,
    ])
  })

  it('adds remove only when a key is registered', () => {
    expect(cloudActionsOf({ githubConnected: true, signingKeyRegistered: true })).toEqual([
      ECloudAction.SignOut,
      ECloudAction.Upload,
      ECloudAction.Download,
      ECloudAction.Github,
      ECloudAction.SigningKey,
      ECloudAction.SigningKeyRemove,
    ])
  })

  it('never lists signing actions when GitHub is not connected, even with a stale key', () => {
    expect(cloudActionsOf({ githubConnected: false, signingKeyRegistered: true })).not.toContain(
      ECloudAction.SigningKeyRemove,
    )
  })
})

const press = (name: string): KeyEvent =>
  new KeyEvent({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: '',
    number: false,
    raw: '',
    eventType: 'press',
    source: 'raw',
  })

type Box = { control: CloudPageControl | null; setRegistered: (next: boolean) => void }

describe('useCloudPage selection', () => {
  it('does not fall back onto Remove when the key row disappears and returns', async () => {
    const calls: string[] = []
    const box: Box = { control: null, setRegistered: () => undefined }
    const cloud = cloudOf(remote())

    const Page = (): null => {
      const [registered, setRegistered] = useState(true)
      box.setRegistered = setRegistered
      box.control = useCloudPage({
        cloud,
        loginStatus: ESettingsLogin.Idle,
        onSignOut: () => calls.push('sign-out'),
        onBeginSignIn: () => calls.push('begin'),
        onUpload: () => calls.push('upload'),
        onDownload: () => calls.push('download'),
        onGithubActivate: () => calls.push('github'),
        onSigningKeyActivate: () => calls.push('signing-key'),
        onSigningKeyRemove: () => calls.push('remove'),
        githubConnected: true,
        signingKeyRegistered: registered,
      })
      return null
    }

    const setup = await testRender(<Page />, { width: 20, height: 4 })
    const control = (): CloudPageControl => {
      if (box.control === null) throw new Error('the page never mounted')
      return box.control
    }
    const context = { onCloudPage: true, signedIn: true, rowIndex: 0, rowCount: 1 }

    try {
      for (let step = 0; step < 5; step += 1) {
        await act(async () => {
          control().handleKey(press('down'), context)
        })
      }
      expect(control().action).toBe(ECloudAction.SigningKeyRemove)

      await act(async () => box.setRegistered(false))
      await act(async () => box.setRegistered(true))

      expect(control().action).not.toBe(ECloudAction.SigningKeyRemove)

      await act(async () => control().handleActivate())
      expect(calls).not.toContain('remove')
    } finally {
      await teardown(setup)
    }
  })
})
