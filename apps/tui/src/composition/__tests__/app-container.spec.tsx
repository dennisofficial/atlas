import { afterEach, describe, expect, it } from 'bun:test'

import React from 'react'
import { testRender } from '@opentui/react/test-utils'

import type { SettingsDocument } from '@dltech/atlas-core'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { open, spokenIn, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => dismissNotice())

const speaking = (settings?: SettingsDocument): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }),
    ...(settings === undefined ? {} : { settings }),
  })

const switchTo = async (mounted: Awaited<ReturnType<typeof open>>, argument: string) => {
  await mounted.typeText(`/container ${argument}`)
  mounted.pressEnter()
  await mounted.frame()
}

describe('the container command', () => {
  it('answers where the conversation runs without placing it', async () => {
    const app = speaking()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      await switchTo(mounted, '')

      expect(app.threads.chosenLocations).toEqual([])
    } finally {
      await mounted.done()
    }
  })
})

describe('the location pill in the footer', () => {
  it('shows no location chip before the thread is placed', async () => {
    const app = speaking()
    const setup = await testRender(<App app={app} opened={await spokenIn(app)} />, {
      width: 140,
      height: 40,
    })

    try {
      await setup.flush()
      await settle(250)
      await setup.flush()

      expect(setup.captureCharFrame()).not.toContain('docker')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
