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

  it('offers a real sign-in row instead of pointing at the accounts overlay', async () => {
    const app = appWith({ signedOut: true })
    const setup = await onAccountTab(app)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('not signed in')
      expect(frame).toContain('Sign in')
      expect(frame).not.toContain('from the accounts overlay')
      expect(frame).not.toContain('Sign out')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('begins the device flow on \u23ce and fails cleanly once the cloud cannot be reached', async () => {
    const app = appWith({ signedOut: true })
    const setup = await onAccountTab(app)

    try {
      setup.mockInput.pressEnter()
      await settle(600)
      await setup.flush()

      const failed = setup.captureCharFrame()
      expect(failed).toContain('unreachable')
      expect(app.cloud.session()).toBeNull()
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('stops the flow when escape closes settings mid sign-in', async () => {
    const app = appWith({ signedOut: true })
    const setup = await onAccountTab(app)

    try {
      setup.mockInput.pressEnter()
      setup.mockInput.pressEscape()
      await landed(setup)

      expect(setup.captureCharFrame()).not.toContain('ATLAS CLOUD')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
