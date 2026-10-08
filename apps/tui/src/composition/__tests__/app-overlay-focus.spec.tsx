import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type OperatorInputRequest } from '@dltech/atlas-harness'
import { toRunId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { THREAD, editorIn, spokenIn, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { ControlledRotation } from './rotation-fixture'

await grammarsReady()

const WIDE = { width: 150, height: 40 }

const HEADING = 'ROTATING'

const INPUT_REQUEST: OperatorInputRequest = {
  requestId: 'input-request',
  description: 'Paste the complete document, including blank lines',
  url: 'https://example.com/authorize?code=readable',
  path: '/tmp/operator-input.txt',
}

type Mounted = Awaited<ReturnType<typeof testRender>>

const appWith = (rotation: ControlledRotation): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    rotation,
  })

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

async function ran(setup: Mounted, typed: string): Promise<void> {
  await setup.mockInput.typeText(typed)
  await setup.flush()
  setup.mockInput.pressEnter()
  await setup.flush()
  await settle(150)
  await setup.flush()
}

const editorFocused = (setup: Mounted): boolean =>
  editorIn(setup.renderer.root)?.focused ?? false

describe('overlay focus arbitration', () => {
  it('blurs the composer while the rotating overlay is up and refocuses on close', async () => {
    const rotation = new ControlledRotation()
    const restoreHome = tempHome()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      expect(editorFocused(setup)).toBe(true)

      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })

      expect(
        await until({ holds: async () => !editorFocused(setup), within: 2_000 }),
      ).toBe(true)

      const successor = await (async () => {
        const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
        await app.log.append({
          threadId: thread.id,
          runId: toRunId('run-successor'),
          drafts: [{ type: 'user-said', text: 'You are the successor main agent.' }],
        })
        return thread.id
      })()

      rotation.resolve({
        kind: 'committed',
        sessionId: THREAD,
        operationId: 'op',
        predecessor: THREAD,
        successor,
        handoffPath: '/tmp/handoff.md',
        watermarkSeq: 1,
      })

      expect(
        await until({ holds: async () => editorFocused(setup), within: 2_000 }),
      ).toBe(true)
    } finally {
      await teardown(setup)
      restoreHome()
    }
  }, 60_000)

  it('echoes typed characters into the blurred draft without a visible caret, and queues them', async () => {
    const rotation = new ControlledRotation()
    const restoreHome = tempHome()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })
      await until({ holds: async () => !editorFocused(setup), within: 2_000 })

      await setup.mockInput.typeText('and then run the tests')
      await setup.flush()
      await settle(150)
      await setup.flush()

      expect(editorIn(setup.renderer.root)?.plainText).toBe('and then run the tests')
      expect(editorFocused(setup)).toBe(false)

      setup.mockInput.pressEnter()
      await setup.flush()
      await settle(150)
      await setup.flush()

      const queued = app.pending.forThread({ threadId: THREAD }).getSnapshot()
      expect(queued.map((entry) => ('text' in entry ? entry.text : ''))).toContain(
        'and then run the tests',
      )
    } finally {
      await teardown(setup)
      restoreHome()
    }
  }, 60_000)

  it('gives the operator-input overlay its own focus without blurring the composer', async () => {
    const rotation = new ControlledRotation()
    const restoreHome = tempHome()
    const app = appWith(rotation)
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

      expect(
        await until({ holds: async () => composer?.focused === true, within: 2_000 }),
      ).toBe(true)
    } finally {
      await teardown(setup)
      restoreHome()
    }
  }, 60_000)

  it('keeps the composer blurred when a covering overlay closes over a blocking one', async () => {
    const rotation = new ControlledRotation()
    const restoreHome = tempHome()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })
      await until({ holds: async () => !editorFocused(setup), within: 2_000 })

      setup.mockInput.pressKey('t', { ctrl: true })
      await frameShowing({ setup, text: 'BACKGROUND SHELLS' })

      setup.mockInput.pressEscape()
      await setup.flush()
      await settle(150)
      await setup.flush()

      expect(editorFocused(setup)).toBe(false)
    } finally {
      await teardown(setup)
      restoreHome()
    }
  }, 60_000)
})
