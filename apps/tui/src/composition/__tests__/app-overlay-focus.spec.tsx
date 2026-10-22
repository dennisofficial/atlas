import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type OperatorInputRequest } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { THREAD, editorIn, spokenIn, until } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const WIDE = { width: 150, height: 40 }

const INPUT_REQUEST: OperatorInputRequest = {
  requestId: 'input-request',
  description: 'Paste the complete document, including blank lines',
  url: 'https://example.com/authorize?code=readable',
  path: '/tmp/operator-input.txt',
}

type Mounted = Awaited<ReturnType<typeof testRender>>

const appWith = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }) })

function tempHome(): () => void {
  const previous = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), 'atlas-overlay-focus-'))
  return () => {
    if (previous === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = previous
  }
}

async function mounted(app: FakeApp): Promise<Mounted> {
  const opened = await spokenIn(app)
  const setup = await testRender(<App app={app} opened={opened} />, WIDE)
  await frameShowing({ setup, text: 'what is in here?' })
  return setup
}

describe('overlay focus arbitration', () => {
  it('gives the operator-input overlay its own focus without blurring the composer', async () => {
    const restoreHome = tempHome()
    const app = appWith()
    const setup = await mounted(app)
    try {
      const composer = editorIn(setup.renderer.root)
      expect(composer?.focused).toBe(true)

      const publisher = app.channel.publisherFor({ threadId: THREAD })
      publisher.operatorInput({ open: INPUT_REQUEST })

      await frameWhen({
        setup,
        holds: (frame) => frame.includes(INPUT_REQUEST.description),
        describe: 'the operator input overlay',
      })

      // The overlay's own field holds focus; the composer must not have been blurred into
      // editing its buffer behind the overlay — the draft survives untouched.
      expect(composer?.focused).toBe(false)
      expect(composer?.plainText).toBe('')

      await setup.mockInput.typeText('operator answer')
      await setup.flush()
      await settle(150)
      await setup.flush()

      expect(composer?.plainText).toBe('')

      publisher.operatorInput({ open: null })
      await setup.flush()
      await settle(150)
      await setup.flush()

      expect(await until({ holds: async () => composer?.focused === true, within: 2_000 })).toBe(
        true,
      )
    } finally {
      await teardown(setup)
      restoreHome()
    }
  }, 60_000)
})
