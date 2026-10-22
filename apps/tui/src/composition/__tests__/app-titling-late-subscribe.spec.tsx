import { describe, expect, it } from 'bun:test'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { App } from '../app'
import { spokenIn, until, THREAD, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

const NAME = 'Refresh-token rotation'
const WITHIN_MS = 20_000

/**
 * The live shape the titling trace caught: the titler's rename lands while the React tree has no
 * onRename listener yet (listeners=0 in the op log), so the echo fires into nobody and the sidebar
 * used to stay on the opening line until a restart re-read the meta. The store already holds the
 * title at mount here — the hook must pick it up off the store rather than wait on an echo that
 * already fired.
 */
describe('a rename that landed before the conversation mounted', () => {
  it('still heads the sidebar with the stored title', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }) })
    await app.threads.create({ id: THREAD })
    const opened = await spokenIn(app)
    await app.threads.rename({ threadId: THREAD, title: NAME })

    const setup = await testRender(<App app={app} opened={opened} />, { width: 140, height: 40 })

    try {
      const headed = await until({
        holds: async () => {
          await setup.flush()
          await settle(250)
          await setup.flush()
          return setup.captureCharFrame().includes(NAME)
        },
        within: WITHIN_MS,
      })

      expect(headed).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
