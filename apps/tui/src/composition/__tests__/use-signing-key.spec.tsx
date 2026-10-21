import { afterEach, describe, expect, it } from 'vitest'

import { SSH_SIGNING_SCOPE_NOTICE } from '@dltech/atlas-wire'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { ESigningKeyView } from '../../ui/components/settings/signing-key-row'
import { clearNotice, currentNotices } from '../../ui/notice-store'
import {
  cloudOf,
  controlOf,
  count,
  expectUntil,
  Key,
  remote,
  removeDirectories,
  SCOPE_KEY,
  type Probe,
  type Remote,
} from './use-signing-key-fixture'

afterEach(() => {
  clearNotice({ key: SCOPE_KEY })
  removeDirectories()
})

async function mounted(args: { state: Remote; login: string | null }) {
  const probe: Probe = { control: null }
  const cloud = cloudOf(args.state)
  const setup = await testRender(
    <Key cloud={cloud} state={args.state} login={args.login} probe={probe} />,
    { width: 40, height: 4 },
  )
  return { probe, setup, done: () => teardown(setup) }
}

describe('useSigningKey', () => {
  it('registers a key once GitHub has a login and reports the fingerprint tail', async () => {
    const state = remote()
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      expect(controlOf(probe).view.fingerprintTail).toBe('CDEFGHIJ')
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('registers once on boot when GitHub is already connected, and not again for the same login', async () => {
    const state = remote()
    state.githubConnected = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      await settle(100)
      expect(count(state, 'GET /v1/github')).toBeGreaterThan(0)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('registers from the boot check alone when the settings login has not arrived', async () => {
    const state = remote()
    state.githubConnected = true
    const { probe, done } = await mounted({ state, login: null })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('does not register without a GitHub login', async () => {
    const state = remote()
    const { probe, done } = await mounted({ state, login: null })

    try {
      await settle(100)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(0)
      expect(controlOf(probe).view.state).toBe(ESigningKeyView.Absent)
    } finally {
      await done()
    }
  })

  it('leaves an existing key alone and registers nothing', async () => {
    const state = remote()
    state.registered = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(0)
    } finally {
      await done()
    }
  })

  it('raises the scope notice and reads scope-missing when GitHub lacks the scope', async () => {
    const state = remote()
    state.scopeMissing = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.ScopeMissing)
      expect(currentNotices().map((notice) => notice.text)).toContain(SSH_SIGNING_SCOPE_NOTICE)
    } finally {
      await done()
    }
  })

  it('maps an unreachable cloud to the unavailable view on refresh', async () => {
    const state = remote()
    state.down = true
    const { probe, done } = await mounted({ state, login: null })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Unavailable)
    } finally {
      await done()
    }
  })

  it('rotates and then removes, announcing each', async () => {
    const state = remote()
    state.registered = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)

      controlOf(probe).activateRotateOrEnable()
      await expectUntil(() => count(state, 'POST /v1/ssh-signing-key/rotate') === 1)
      await expectUntil(() => currentNotices().some((n) => n.text === 'commit signing key rotated'))

      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      controlOf(probe).activateRemove()
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Absent)
      expect(currentNotices().some((n) => n.text === 'commit signing key removed')).toBe(true)
    } finally {
      await done()
    }
  })

  it('ignores a second remove while the first is in flight', async () => {
    const state = remote()
    state.registered = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      const control = controlOf(probe)

      control.activateRemove()
      control.activateRemove()
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Absent)

      expect(count(state, 'DELETE /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('uploads one key when two mounts see the same login', async () => {
    const state = remote()
    const first: Probe = { control: null }
    const second: Probe = { control: null }
    const cloud = cloudOf(state)
    const setup = await testRender(
      <>
        <Key cloud={cloud} state={state} login="octocat" probe={first} />
        <Key cloud={cloud} state={state} login="octocat" probe={second} />
      </>,
      { width: 40, height: 4 },
    )

    try {
      await expectUntil(() => controlOf(first).view.state === ESigningKeyView.Registered)
      await settle(100)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await teardown(setup)
    }
  })

  it('drops a deferred ensure result that lands after unmount', async () => {
    const state = remote()
    state.scopeMissing = true
    let release: () => void = () => undefined
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { setup } = await mounted({ state, login: 'octocat' })

    await expectUntil(() => count(state, 'GET /v1/ssh-signing-key/status') === 1)
    await teardown(setup)
    await settle(50)
    release()
    await settle(150)

    expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    expect(currentNotices().map((notice) => notice.text)).not.toContain(SSH_SIGNING_SCOPE_NOTICE)
  })
})
