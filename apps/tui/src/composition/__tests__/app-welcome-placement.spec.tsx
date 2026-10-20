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
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { unstartedConversation } from '../open-conversation'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => dismissNotice())

const HOST_HINT = '↓ to the footer chip, ⏎ for a pod'

const appOn = (args: { shape?: 'chip' | 'hero' }): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cwd: mkdtempSync(join(tmpdir(), 'atlas-hero-spec-')),
    secrets: { [ESettingId.VercelToken]: 'vercel-token' },
    settings: {
      values: {
        [ESettingId.Accent]: 'clay',
        [ESettingId.VercelTeamId]: 'team_1',
        [ESettingId.VercelProjectId]: 'prj_1',
        ...(args.shape === undefined ? {} : { [ESettingId.PlacementChooserShape]: args.shape }),
      },
    },
  })

const mount = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-hero-home-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const setup = await testRender(
    <App
      app={args.app}
      opened={unstartedConversation({ ids: args.app.ids })}
      createBridge={() => args.bridge}
      preflightBirth={async () => null}
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
    command: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      return frame()
    },
    down: () => setup.mockInput.pressArrow('down'),
    enter: () => setup.mockInput.pressEnter(),
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    },
  }
}

type Mounted = Awaited<ReturnType<typeof mount>>

const frameHolds = async (args: { mounted: Mounted; holds: (frame: string) => boolean }): Promise<boolean> =>
  until({ holds: async () => args.holds(await args.mounted.frame()), within: 20_000 })

describe('the welcome hero placement shape', () => {
  it('surfaces the host placement and its hint on a fresh thread', async () => {
    const mounted = await mount({ app: appOn({ shape: 'hero' }), bridge: fakeBridge() })

    try {

      expect(
        await frameHolds({
          mounted,
          holds: (frame) => frame.includes('· ☁ local') && frame.includes(HOST_HINT),
        }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('retires with the first message, footer chip and all', async () => {
    const mounted = await mount({ app: appOn({ shape: 'hero' }), bridge: fakeBridge() })

    try {
      expect(await frameHolds({ mounted, holds: (frame) => frame.includes(HOST_HINT) })).toBe(true)

      await mounted.command('hello from the hero')

      expect(
        await frameHolds({
          mounted,
          holds: (frame) => !frame.includes(HOST_HINT) && !frame.includes('☁ local') && !frame.includes('host ▾'),
        }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows no placement in the hero while the setting is unset', async () => {
    const mounted = await mount({ app: appOn({}), bridge: fakeBridge() })

    try {
      expect(await frameHolds({ mounted, holds: (frame) => frame.includes('host ▾') })).toBe(true)

      const frame = await mounted.frame()

      expect(frame).not.toContain(HOST_HINT)
      expect(frame).not.toContain('· ☁ local')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('still births a pod through the footer chip', async () => {
    const bridge = fakeBridge()
    const mounted = await mount({ app: appOn({ shape: 'hero' }), bridge })

    try {
      expect(await frameHolds({ mounted, holds: (frame) => frame.includes(HOST_HINT) })).toBe(true)
      expect(bridge.created.length).toBe(0)

      mounted.down()
      await mounted.frame()
      mounted.enter()

      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
