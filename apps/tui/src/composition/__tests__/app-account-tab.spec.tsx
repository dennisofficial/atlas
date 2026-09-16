import { toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeApp, fakeSignedOutCloud, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const THREAD = toThreadId('opened-thread')

const WIDE = { width: 150, height: 40 }

type Mounted = Awaited<ReturnType<typeof testRender>>

const READ_MS = 60

const appWith = (args?: { signedOut?: boolean }): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    ...(args?.signedOut === true ? { cloud: fakeSignedOutCloud() } : {}),
  })

async function landed(setup: Mounted): Promise<void> {
  await settle(READ_MS)
  await setup.flush()
}

async function onAccountTab(app: FakeApp): Promise<Mounted> {
  const setup = await testRender(
    <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
    WIDE,
  )
  await setup.flush()
  await settle(250)
  await setup.flush()

  setup.mockInput.pressKey('o', { ctrl: true })
  await landed(setup)
  setup.mockInput.pressTab()
  await landed(setup)
  setup.mockInput.pressTab()
  await landed(setup)
  return setup
}

describe('the settings account tab', () => {
  it('names the signed-in account and offers sign-out', async () => {
    const app = appWith()
    const setup = await onAccountTab(app)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('ATLAS CLOUD')
      expect(frame).toContain('test@atlas.dev')
      expect(frame).toContain('Sign out')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('signs out on ⏎ and the tab reads signed out', async () => {
    const app = appWith()
    const setup = await onAccountTab(app)

    try {
      expect(app.cloud.session()).not.toBeNull()

      setup.mockInput.pressEnter()
      await landed(setup)

      expect(app.cloud.session()).toBeNull()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('not signed in')
      expect(frame).not.toContain('test@atlas.dev')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('points a signed-out session at the accounts overlay instead of offering sign-out', async () => {
    const app = appWith({ signedOut: true })
    const setup = await onAccountTab(app)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('not signed in')
      expect(frame).toContain('ctrl+a')
      expect(frame).not.toContain('Sign out')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
