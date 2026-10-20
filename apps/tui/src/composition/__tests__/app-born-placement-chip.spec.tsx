import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EHarnessPlacement, ERunner, ESettingId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { CLOUD_NOT_CONFIGURED_NOTICE } from '../cloud/born-cloud'
import { unstartedConversation } from '../open-conversation'
import { spokenIn, until } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => dismissNotice())

const workspaceRoot = (): string => mkdtempSync(join(tmpdir(), 'atlas-chip-spec-'))

const appOn = (args: { configured: boolean }): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cwd: workspaceRoot(),
    ...(args.configured ? { secrets: { [ESettingId.VercelToken]: 'vercel-token' } } : {}),
    settings: {
      values: {
        [ESettingId.Accent]: 'clay',
        ...(args.configured
          ? { [ESettingId.VercelTeamId]: 'team_1', [ESettingId.VercelProjectId]: 'prj_1' }
          : {}),
      },
    },
  })

const mount = async (args: { app: FakeApp; bridge: FakeBridge; fresh?: boolean | undefined }) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-chip-home-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const setup = await testRender(
    <App
      app={args.app}
      opened={
        args.fresh === true ? unstartedConversation({ ids: args.app.ids }) : await spokenIn(args.app)
      }
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
    typeDraft: async (text: string) => {
      await setup.mockInput.typeText(text)
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

const newThread = async (mounted: Mounted): Promise<void> => {
  await mounted.command('/new')
}

const chipShows = async (mounted: Mounted, text: string): Promise<boolean> =>
  until({ holds: async () => (await mounted.frame()).includes(`${text.trim()} ▾`), within: 20_000 })

const flipChip = async (mounted: Mounted): Promise<void> => {
  mounted.down()
  await mounted.frame()
  mounted.enter()
  await mounted.frame()
}

const lastChoice = (app: FakeApp): unknown =>
  app.settings.snapshot().document.values[ESettingId.LastBornPlacement]

const mountFresh = (args: { app: FakeApp; bridge: FakeBridge }): Promise<Mounted> =>
  mount({ ...args, fresh: true })

describe('the placement chip in the composer footer', () => {
  it('births a pod on /new by default', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)

      expect(await chipShows(mounted, ' pod ')).toBe(true)
      expect(bridge.created.length).toBe(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('places the pod-born thread in the cloud and records its runner', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)

      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
      const threadId = bridge.created[0]?.threadId
      expect(threadId).toBeDefined()
      const record = await until({
        holds: async () => app.sessionOwner.placement.snapshot(threadId!)?.placement.harness === EHarnessPlacement.Cloud,
        within: 20_000,
      })
      expect(record).toBe(true)
      expect(app.threads.chosenRunners).toContainEqual({ threadId: threadId!, runner: ERunner.Local })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('flips a pod thread to Vercel and back, rebirthing under a new id each time', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' pod ')).toBe(true)

      await flipChip(mounted)
      expect(await chipShows(mounted, '☁ cloud')).toBe(true)
      expect(bridge.created.length).toBe(2)
      expect(bridge.created[1]?.threadId).not.toBe(bridge.created[0]?.threadId)
      expect(lastChoice(app)).toBe('cloud')

      await flipChip(mounted)
      expect(await chipShows(mounted, ' pod ')).toBe(true)
      expect(bridge.created.length).toBe(3)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births a pod on every /new, even right after the operator chose Vercel', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' pod ')).toBe(true)
      await flipChip(mounted)
      expect(await chipShows(mounted, '☁ cloud')).toBe(true)

      await newThread(mounted)

      expect(await chipShows(mounted, ' pod ')).toBe(true)
      expect(bridge.created.length).toBe(3)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the draft across an unsent runner flip', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' pod ')).toBe(true)

      await mounted.typeDraft('a draft worth keeping')
      await flipChip(mounted)

      expect(await chipShows(mounted, '☁ cloud')).toBe(true)
      const draftVisible = await until({
        holds: async () => (await mounted.frame()).includes('a draft worth keeping'),
        within: 20_000,
      })
      expect(draftVisible).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('refuses to flip a thread that has already sent', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mountFresh({ app, bridge })

    try {
      expect(await chipShows(mounted, ' host ')).toBe(true)

      await mounted.command('sent, so the placement is locked')
      const startedId = app.sessionOwner.snapshot().threadId!
      expect(await until({
        holds: async () => app.sessionOwner.placement.snapshot(startedId)?.placement.harness === EHarnessPlacement.Host,
        within: 20_000,
      })).toBe(true)

      await flipChip(mounted)

      expect(app.sessionOwner.placement.snapshot(startedId)?.placement.harness).toBe(EHarnessPlacement.Host)
      expect(await chipShows(mounted, ' pod ')).toBe(false)
      expect(bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births a pod without any notice on a machine without a Vercel token', async () => {
    const app = appOn({ configured: false })
    const mounted = await mount({ app, bridge: fakeBridge() })

    try {
      await newThread(mounted)

      expect(await chipShows(mounted, ' pod ')).toBe(true)
      expect(currentNotices().map((notice) => notice.text)).not.toContain(CLOUD_NOT_CONFIGURED_NOTICE)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('explains the refusal and keeps the pod when Vercel is chosen without a Vercel token', async () => {
    const app = appOn({ configured: false })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' pod ')).toBe(true)

      await flipChip(mounted)

      const noticed = await until({
        holds: async () => currentNotices().some((notice) => notice.text === CLOUD_NOT_CONFIGURED_NOTICE),
        within: 20_000,
      })
      expect(noticed).toBe(true)
      expect(await chipShows(mounted, ' pod ')).toBe(true)
      expect(bridge.created.length).toBe(1)
      expect(bridge.destroyed.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('the placement chip on a fresh, unsent thread', () => {
  it('shows the host default with the flip affordance before any /new', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mountFresh({ app, bridge })

    try {
      expect(await chipShows(mounted, ' host ')).toBe(true)
      expect(bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('flips a fresh thread to a pod under the same id and settles on the first send', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mountFresh({ app, bridge })

    try {
      expect(await chipShows(mounted, ' host ')).toBe(true)
      const freshId = app.sessionOwner.snapshot().threadId

      await flipChip(mounted)
      expect(await chipShows(mounted, ' pod ')).toBe(true)
      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
      expect(bridge.created[0]?.threadId).toBe(freshId!)

      await mounted.command('ship it')
      const threadId = bridge.created[0]?.threadId
      const settled = await until({
        holds: async () =>
          app.sessionOwner.placement.snapshot(threadId!)?.placement.harness === EHarnessPlacement.Cloud,
        within: 20_000,
      })
      expect(settled).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('settles the chip away on the first send of a fresh host thread', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mountFresh({ app, bridge })

    try {
      expect(await chipShows(mounted, ' host ')).toBe(true)

      await mounted.command('hello, fresh tile')

      const threadId = app.sessionOwner.snapshot().threadId!
      const settled = await until({
        holds: async () =>
          app.sessionOwner.placement.snapshot(threadId)?.placement.harness === EHarnessPlacement.Host &&
          !(await mounted.frame()).includes('host ▾'),
        within: 20_000,
      })
      expect(settled).toBe(true)
      expect(bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
