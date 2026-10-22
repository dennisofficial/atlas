import React from 'react'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import type { FakeBridge } from '../cloud/__tests__/fixture'
import type { OpenedConversation } from '../open-conversation'
import type { CloudBridgeFactory } from '../cloud/bridge-factory'
import { spokenIn, until } from './app-fixture'
import type { FakeApp } from './fake-app'
import { FakeSessionDisk } from './fake-session-disk'

export const mountCloud = async (args: {
  app: FakeApp
  bridge: FakeBridge
  opened?: OpenedConversation
}) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-cloud-archive-spec-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const disk = new FakeSessionDisk(home)
  args.app.log.mirrorTo(disk)
  args.app.threads.mirrorTo(disk)
  args.bridge.sourceStores({
    log: args.app.log,
    threads: args.app.threads,
    workspace: args.app.workspace.workspace,
    disk,
  })
  const createBridge: CloudBridgeFactory = () => args.bridge
  const opened = args.opened ?? (await spokenIn(args.app))
  await disk.writeSessionMeta({ threadId: opened.threadId })
  await disk.stampProvenance({ threadId: opened.threadId, archiveDigest: null })
  const setup = await testRender(
    <App
      app={args.app}
      opened={opened}
      createBridge={createBridge}
      preflightBirth={async () => null}
    />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )

  const nextFrame = async (): Promise<string> => {
    await setup.flush()
    return setup.captureCharFrame()
  }

  const showing = async (text: string): Promise<string> => {
    let frame = ''
    const found = await until({
      holds: async () => {
        frame = await nextFrame().catch(() => '')
        return frame.includes(text)
      },
      within: 20_000,
    })
    if (!found) throw new Error(`waited past 20000 ms for ${JSON.stringify(text)}\n\n${frame}`)
    return frame
  }

  return {
    nextFrame,
    showing,
    frame: async (): Promise<string> => {
      await setup.flush()
      await settle(250)
      await setup.flush()
      return setup.captureCharFrame()
    },
    command: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      await setup.flush()
      await settle(250)
      await setup.flush()
    },
    pressEscape: () => setup.mockInput.pressEscape(),
    mutedEntries: (): number => {
      let muted = 0
      const walk = (node: unknown): void => {
        const candidate = node as {
          opacity?: unknown
          id?: unknown
          getChildren?: () => readonly unknown[]
        }
        if (candidate.opacity === 0.4 && typeof candidate.id === 'string') muted += 1
        for (const child of candidate.getChildren?.() ?? []) walk(child)
      }
      walk(setup.renderer.root)
      return muted
    },
    pressCtrl: (key: string) => setup.mockInput.pressKey(key, { ctrl: true }),
    click: (at: { x: number; y: number }) => setup.mockMouse.click(at.x, at.y),
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    },
  }
}
