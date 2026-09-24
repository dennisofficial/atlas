import { toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { DOWNLOAD_LABEL, UPLOAD_LABEL } from '../../ui/components/settings/cloud'
import { glyph } from '../../ui/theme'
import { App } from '../app'
import {
  fakeApp,
  fakeCloudWithSyncs,
  fakeSignedOutCloud,
  scriptedModelPort,
  type FakeApp,
} from './fake-app'

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

async function onCloudTab(app: FakeApp): Promise<Mounted> {
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
  return setup
}

const selectedRow = (setup: Mounted): string =>
  setup
    .captureCharFrame()
    .split('\n')
    .find((row) => row.includes(glyph.selected)) ?? ''

describe('the settings cloud tab', () => {
  it('names the signed-in account and offers the cloud actions above the sandbox rows', async () => {
    const app = appWith()
    const setup = await onCloudTab(app)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('ATLAS CLOUD')
      expect(frame).toContain('test@atlas.dev')
      expect(frame).toContain('Sign out')
      expect(frame).toContain(UPLOAD_LABEL)
      expect(frame).toContain(DOWNLOAD_LABEL)
      expect(frame).toContain('GitHub')
      expect(frame).toContain('Vercel token')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('signs out on ⏎ and the tab reads signed out', async () => {
    const app = appWith()
    const setup = await onCloudTab(app)

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

  it('shows only the sign-in row when signed out', async () => {
    const app = appWith({ signedOut: true })
    const setup = await onCloudTab(app)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('not signed in')
      expect(frame).toContain('Sign in')
      expect(frame).not.toContain('from the accounts overlay')
      expect(frame).not.toContain('Sign out')
      expect(frame).not.toContain(UPLOAD_LABEL)
      expect(frame).not.toContain(DOWNLOAD_LABEL)
      expect(frame).not.toContain('GitHub')
      expect(frame).not.toContain('Vercel token')
      expect(frame).not.toContain('Sandbox image')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('begins the device flow on ⏎ and fails cleanly once the cloud cannot be reached', async () => {
    const app = appWith({ signedOut: true })
    const setup = await onCloudTab(app)

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
    const setup = await onCloudTab(app)

    try {
      setup.mockInput.pressEnter()
      setup.mockInput.pressEscape()
      await landed(setup)

      expect(setup.captureCharFrame()).not.toContain('ATLAS CLOUD')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('uploads the local accounts and secrets on ⏎ and says what moved', async () => {
    const { cloud, syncs } = fakeCloudWithSyncs()
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      cloud,
    })
    const setup = await onCloudTab(app)

    try {
      setup.mockInput.pressArrow('down')
      await landed(setup)
      expect(selectedRow(setup)).toContain(UPLOAD_LABEL)

      setup.mockInput.pressEnter()
      await landed(setup)

      expect(syncs.uploads).toBe(1)
      expect(setup.captureCharFrame()).toContain(
        'Uploaded 0 accounts, 0 secrets and 0 mcp servers to the cloud.',
      )
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('clears the upload feedback after a few seconds', async () => {
    const { cloud } = fakeCloudWithSyncs()
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      cloud,
    })
    const setup = await onCloudTab(app)

    try {
      setup.mockInput.pressArrow('down')
      await landed(setup)
      setup.mockInput.pressEnter()
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('Uploaded')

      await settle(7000)
      await setup.flush()

      expect(setup.captureCharFrame()).not.toContain('Uploaded')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('downloads the cloud accounts and secrets on ⏎ and says what moved', async () => {
    const { cloud, syncs } = fakeCloudWithSyncs()
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      cloud,
    })
    const setup = await onCloudTab(app)

    try {
      setup.mockInput.pressArrow('down')
      await landed(setup)
      setup.mockInput.pressArrow('down')
      await landed(setup)
      expect(selectedRow(setup)).toContain(DOWNLOAD_LABEL)

      setup.mockInput.pressEnter()
      await landed(setup)

      expect(syncs.downloads).toBe(1)
      expect(setup.captureCharFrame()).toContain(
        'Downloaded 0 accounts, 0 secrets and 0 mcp servers to this machine.',
      )
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('hands the cursor from the last action to the setting rows and back', async () => {
    const app = appWith()
    const setup = await onCloudTab(app)

    try {
      for (let step = 0; step < 4; step += 1) {
        setup.mockInput.pressArrow('down')
        await landed(setup)
      }
      expect(selectedRow(setup)).toContain('Vercel token')

      setup.mockInput.pressArrow('up')
      await landed(setup)
      expect(selectedRow(setup)).toContain('GitHub')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
