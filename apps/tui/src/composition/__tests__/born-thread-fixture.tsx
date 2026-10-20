import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESettingId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { unstartedConversation } from '../open-conversation'
import { editorIn, promiseGate, until } from './app-fixture'
import { fakeApp, fakeSignedOutCloud, scriptedModelPort, type FakeApp } from './fake-app'

export const bornThreadApp = (args: {
  vercel?: boolean
  signedOut?: boolean
  shape?: 'chip' | 'hero'
}): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cwd: mkdtempSync(join(tmpdir(), 'atlas-born-thread-spec-')),
    ...(args.signedOut === true ? { cloud: fakeSignedOutCloud() } : {}),
    ...(args.vercel === true ? { secrets: { [ESettingId.VercelToken]: 'vercel-token' } } : {}),
    settings: {
      values: {
        [ESettingId.Accent]: 'clay',
        ...(args.vercel === true ? { [ESettingId.VercelTeamId]: 'team_1', [ESettingId.VercelProjectId]: 'prj_1' } : {}),
        ...(args.shape === undefined ? {} : { [ESettingId.PlacementChooserShape]: args.shape }),
      },
    },
  })

export const holdingProvisioning = (bridge: FakeBridge): { release: () => void } => {
  const held = promiseGate()
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = async (given) => {
    await held.gate
    return create(given)
  }
  return { release: held.release }
}

export async function mountUnborn(args: {
  app: FakeApp
  bridge?: FakeBridge
  preflight?: { refusal: string | null }
}) {
  const bridge = args.bridge ?? fakeBridge()
  const preflight = args.preflight ?? { refusal: null }
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), 'atlas-born-thread-home-'))
  const setup = await testRender(
    <App
      app={args.app}
      opened={unstartedConversation({ ids: args.app.ids })}
      createBridge={() => bridge}
      preflightBirth={async () => preflight.refusal}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )
  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }
  const command = async (text: string): Promise<string> => {
    await setup.mockInput.typeText(text)
    setup.mockInput.pressEnter()
    return frame()
  }
  return {
    bridge,
    preflight,
    frame,
    command,
    draft: () => editorIn(setup.renderer.root)?.plainText ?? null,
    dismiss: () => setup.mockInput.pressEscape(),
    frameHolds: (holds: (shown: string) => boolean): Promise<boolean> =>
      until({ holds: async () => holds(await frame()), within: 20_000 }),
    flipChip: async (): Promise<void> => {
      setup.mockInput.pressArrow('down')
      await frame()
      setup.mockInput.pressEnter()
      await frame()
      setup.mockInput.pressArrow('up')
      await frame()
    },
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    },
  }
}

export type MountedUnborn = Awaited<ReturnType<typeof mountUnborn>>
