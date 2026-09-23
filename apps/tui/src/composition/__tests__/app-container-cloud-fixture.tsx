import React from 'react'
import { testRender } from '@opentui/react/test-utils'

import type { ClipboardImageReader } from '../../ui/clipboard-image'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { CLEAN_WORKSPACE, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory, LiftPreflight, WorkspaceCapture } from '../use-cloud-lift'
import { editorIn, spokenIn, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const DIRTY: WorkspaceCapture = async () => ({
  ...CLEAN_WORKSPACE,
  patch: 'diff --git a/src/app.ts b/src/app.ts\n',
})

const STUB_CONTEXT = async (): Promise<Buffer> => Buffer.from('stub-context-archive')

export const speaking = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }) })

/**
 * Streamed slowly enough that a mid-turn lift has a turn to catch: fast enough that `until` still
 * finds it inside the test timeout.
 */
export const slowlySpeaking = (): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY }, perChunkMs: 300 }),
  })

export const mount = async (args: {
  app: FakeApp
  bridge: FakeBridge
  preflightLift?: LiftPreflight
  clipboard?: ClipboardImageReader
}) => {
  const createBridge: CloudBridgeFactory = () => args.bridge
  const setup = await testRender(
    <App
      app={args.app}
      opened={await spokenIn(args.app)}
      createBridge={createBridge}
      preflightLift={args.preflightLift ?? (async () => null)}
      captureWorkspace={DIRTY}
      captureContext={STUB_CONTEXT}
      {...(args.clipboard === undefined ? {} : { clipboard: args.clipboard })}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )

  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }

  const nextFrame = async (): Promise<string> => {
    await setup.flush()
    return setup.captureCharFrame()
  }

  return {
    frame,
    nextFrame,
    run: async (argument: string) => {
      await setup.mockInput.typeText(`/container ${argument}`)
      setup.mockInput.pressEnter()
      return frame()
    },
    command: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      return frame()
    },
    say: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      return frame()
    },
    typeText: (text: string) => setup.mockInput.typeText(text),
    pressEnter: () => setup.mockInput.pressEnter(),
    pressEscape: () => setup.mockInput.pressEscape(),
    pressCtrl: (key: string) => setup.mockInput.pressKey(key, { ctrl: true }),
    pressCtrlC: () => setup.mockInput.pressKey('c', { ctrl: true }),
    draftText: () => editorIn(setup.renderer.root)?.plainText ?? null,
    done: () => teardown(setup),
  }
}
