import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESettingId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { acceptingTheWorkspace } from './app-born-placement-chip.spec'
import { editorIn, promiseGate, until } from './app-fixture'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { unstartedConversation } from '../open-conversation'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => dismissNotice())

const BIRTH_HEADING = 'STARTING A CLOUD SANDBOX'
const HELD_DRAFT = 'hold this draft'

const appOn = (): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cwd: mkdtempSync(join(tmpdir(), 'atlas-birth-overlay-spec-')),
    secrets: { [ESettingId.VercelToken]: 'vercel-token' },
    settings: {
      values: {
        [ESettingId.Accent]: 'clay',
        [ESettingId.VercelTeamId]: 'team_1',
        [ESettingId.VercelProjectId]: 'prj_1',
      },
    },
  })

const holdingProvisioning = (bridge: FakeBridge): { gate: Promise<void>; release: () => void } => {
  const held = promiseGate()
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = async (given) => {
    await held.gate
    return create(given)
  }
  return held
}

const mountFresh = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  acceptingTheWorkspace(args.bridge)
  const home = mkdtempSync(join(tmpdir(), 'atlas-birth-overlay-home-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const setup = await testRender(
    <App
      app={args.app}
      opened={unstartedConversation({ ids: args.app.ids })}
      createBridge={() => args.bridge}
      preflightLift={async () => null}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )
  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }
  return {
    frame,
    down: () => setup.mockInput.pressArrow('down'),
    enter: () => setup.mockInput.pressEnter(),
    typeText: (text: string) => setup.mockInput.typeText(text),
    pressEscape: () => setup.mockInput.pressEscape(),
    draftText: () => editorIn(setup.renderer.root)?.plainText ?? null,
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    },
  }
}

describe('flipping a fresh thread to the cloud', () => {
  it('blocks the composer with the cancellable birth overlay the moment the chip flips', async () => {
    const app = appOn()
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountFresh({ app, bridge })

    try {
      expect(await until({ holds: async () => (await mounted.frame()).includes('local ▾'), within: 20_000 })).toBe(
        true,
      )

      mounted.down()
      await mounted.frame()
      mounted.enter()

      const blocked = await until({
        holds: async () => {
          const frame = await mounted.frame()
          return frame.includes(BIRTH_HEADING) && frame.includes('cancel and keep the draft')
        },
        within: 20_000,
      })
      expect(blocked).toBe(true)
      expect(bridge.created.length).toBe(0)

      await mounted.typeText(HELD_DRAFT)
      expect(mounted.draftText()).toBe('')

      held.release()
      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)

  it('cancelling the overlay falls back to the host with the chip back on local', async () => {
    const app = appOn()
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountFresh({ app, bridge })

    try {
      expect(await until({ holds: async () => (await mounted.frame()).includes('local ▾'), within: 20_000 })).toBe(
        true,
      )

      mounted.down()
      await mounted.frame()
      mounted.enter()

      const blocked = await until({
        holds: async () => (await mounted.frame()).includes(BIRTH_HEADING),
        within: 20_000,
      })
      expect(blocked).toBe(true)

      mounted.pressEscape()

      const backedOff = await until({
        holds: async () => {
          const frame = await mounted.frame()
          return !frame.includes(BIRTH_HEADING) && frame.includes('local ▾')
        },
        within: 20_000,
      })
      expect(backedOff).toBe(true)
      expect(bridge.created.length).toBe(0)
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)
})
