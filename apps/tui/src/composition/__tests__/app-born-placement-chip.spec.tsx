import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EHarnessPlacement, ESettingId } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-wire'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { CLOUD_NOT_CONFIGURED_NOTICE } from '../cloud/born-cloud'
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

type ShippedManifest = {
  trees: { id: string; sourcePath: string; branch: string | null }[]
  family?: {
    rootId: string
    checkouts: { id: string; treeId: string; claimedBy: string }[]
    threads: {
      threadId: string
      home: { treeId: string; relativePath: string }
      active: { treeId: string; base: string | null; adopted: boolean } | null
    }[]
  }
}

const restoredAs = async (archivePath: string) => {
  const raw = await Bun.$`tar -xzOf ${archivePath} manifest.json`.text()
  const manifest = JSON.parse(raw) as ShippedManifest
  const pathOf = (treeId: string): string => manifest.trees.find((tree) => tree.id === treeId)?.sourcePath ?? ''
  const family = manifest.family
  return {
    cwd: pathOf(manifest.trees[0]?.id ?? ''),
    repository: null,
    trees: manifest.trees.map((tree) => ({ ...tree, path: tree.sourcePath, renamedFrom: null })),
    ...(family === undefined
      ? {}
      : {
          family: {
            rootId: family.rootId,
            checkouts: family.checkouts.map((checkout) => ({
              id: checkout.id,
              path: pathOf(checkout.treeId),
              claimedBy: checkout.claimedBy,
            })),
            threads: family.threads.map((thread) => ({
              threadId: thread.threadId,
              home: [pathOf(thread.home.treeId), thread.home.relativePath].filter((part) => part !== '').join('/'),
              active:
                thread.active === null
                  ? null
                  : {
                      path: pathOf(thread.active.treeId),
                      branch: manifest.trees.find((tree) => tree.id === thread.active?.treeId)?.branch ?? 'HEAD',
                      base: thread.active.base,
                      adopted: thread.active.adopted,
                    },
            })),
          },
        }),
  }
}

const acceptingTheWorkspace = (bridge: FakeBridge): FakeBridge => {
  let shipped: string | undefined
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = (given) => {
    shipped = given.workspaceArchivePath
    return create(given)
  }
  const attach = bridge.attach
  bridge.attach = (given) => {
    const attachment = attach(given)
    const request = attachment.channel.request
    attachment.channel.request = async (call) =>
      call.op === EClientRequest.ApplyWorkspaceArchive && shipped !== undefined
        ? { applied: true, restored: await restoredAs(shipped) }
        : request(call)
    return attachment
  }
  return bridge
}

const mount = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  acceptingTheWorkspace(args.bridge)
  const home = mkdtempSync(join(tmpdir(), 'atlas-chip-home-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const setup = await testRender(
    <App
      app={args.app}
      opened={await spokenIn(args.app)}
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

describe('the placement chip in the composer footer', () => {
  it('starts a new thread local on a configured machine, without provisioning a sandbox', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)

      expect(await chipShows(mounted, ' local ')).toBe(true)
      expect(bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births a cloud-born thread when the first message is sent after choosing the cloud', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' local ')).toBe(true)
      expect(bridge.created.length).toBe(0)

      await flipChip(mounted)

      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
      const threadId = bridge.created[0]?.threadId
      expect(threadId).toBeDefined()
      const record = await until({
        holds: async () => app.sessionOwner.placement.snapshot(threadId!)?.placement.harness === EHarnessPlacement.Cloud,
        within: 20_000,
      })
      expect(record).toBe(true)
      expect(app.sessionOwner.placement.snapshot(threadId!)?.placement.harness).toBe(EHarnessPlacement.Cloud)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births a local thread when the host is chosen, and remembers it', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      await flipChip(mounted)
      expect(await chipShows(mounted, '☁ cloud')).toBe(true)

      await flipChip(mounted)
      expect(await chipShows(mounted, ' local ')).toBe(true)

      await mounted.command('hello from the host')
      const threadId = app.sessionOwner.snapshot().threadId!
      const placed = await until({
        holds: async () => app.sessionOwner.placement.snapshot(threadId)?.placement.harness === EHarnessPlacement.Host,
        within: 20_000,
      })

      expect(placed).toBe(true)
      expect(app.sessionOwner.placement.snapshot(threadId)?.placement.harness).toBe(EHarnessPlacement.Host)
      expect(lastChoice(app)).toBe('host')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('starts every /new local, even right after the operator chose the cloud', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' local ')).toBe(true)
      await flipChip(mounted)
      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(true)
      expect(await chipShows(mounted, '☁ cloud')).toBe(true)

      await newThread(mounted)

      expect(await chipShows(mounted, ' local ')).toBe(true)
      expect(bridge.created.length).toBe(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the draft across an unsent cloud→host flip', async () => {
    const app = appOn({ configured: true })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      await flipChip(mounted)
      expect(await chipShows(mounted, '☁ cloud')).toBe(true)

      await mounted.typeDraft('a draft worth keeping')
      await flipChip(mounted)

      expect(await chipShows(mounted, ' local ')).toBe(true)
      const threadId = app.sessionOwner.snapshot().threadId!
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
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' local ')).toBe(true)

      await mounted.command('sent, so the placement is locked')
      const startedId = app.sessionOwner.snapshot().threadId!
      expect(await until({
        holds: async () => app.sessionOwner.placement.snapshot(startedId)?.placement.harness === EHarnessPlacement.Host,
        within: 20_000,
      })).toBe(true)
      expect(app.sessionOwner.placement.snapshot(startedId)?.placement.harness).toBe(EHarnessPlacement.Host)

      await flipChip(mounted)

      expect(app.sessionOwner.placement.snapshot(startedId)?.placement.harness).toBe(EHarnessPlacement.Host)
      expect(await chipShows(mounted, '☁ cloud')).toBe(false)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('starts local without any notice on a machine without a Vercel token', async () => {
    const app = appOn({ configured: false })
    const mounted = await mount({ app, bridge: fakeBridge() })

    try {
      await newThread(mounted)

      expect(await chipShows(mounted, ' local ')).toBe(true)
      expect(currentNotices().map((notice) => notice.text)).not.toContain(CLOUD_NOT_CONFIGURED_NOTICE)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('explains the fallback when the cloud is chosen on a machine without a Vercel token', async () => {
    const app = appOn({ configured: false })
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await newThread(mounted)
      expect(await chipShows(mounted, ' local ')).toBe(true)

      await flipChip(mounted)

      const noticed = await until({
        holds: async () => currentNotices().some((notice) => notice.text === CLOUD_NOT_CONFIGURED_NOTICE),
        within: 20_000,
      })
      expect(noticed).toBe(true)
      expect(await chipShows(mounted, ' local ')).toBe(true)
      expect(bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
