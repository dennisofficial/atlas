import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import type { OpenedConversation } from '../open-conversation'
import { open, THREAD, REPLY, THINKING } from './app-fixture'
import { FAKE_WORKSPACE } from './fake-backend'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const UNSTARTED: OpenedConversation = {
  threadId: THREAD,
  events: [],
  turns: [],
  name: null,
  started: false,
}

const WIDE = { width: 140, height: 40 }

/** The wordmark is the sidebar's alone — the footer carries where you are and what answers. */
const SIDEBAR_MARK = '● atlas'

const speaking = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }) })

describe('the welcome screen a conversation opens on', () => {
  it('keeps the sidebar away, since there is no conversation for it to read', async () => {
    const setup = await testRender(<App app={speaking()} opened={UNSTARTED} />, WIDE)

    try {
      await setup.flush()
      await settle(250)
      await setup.flush()

      expect(setup.captureCharFrame()).not.toContain(SIDEBAR_MARK)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('a conversation nobody has spoken in', () => {
  it('writes nothing to the store while it sits on the welcome screen', async () => {
    const mounted = await open({ app: speaking(), opened: UNSTARTED })

    try {
      await mounted.frame()

      expect(mounted.app.threads.created).toBe(0)
      expect(await mounted.app.threads.list({ project: FAKE_WORKSPACE })).toEqual([])
    } finally {
      await mounted.done()
    }
  })
})
