import React from 'react'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'

import { EClientRequest, type LiftWorkspaceCapture } from '@dltech/atlas-harness'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { CLEAN_WORKSPACE, type FakeBridge } from '../cloud/__tests__/fixture'
import type { OpenedConversation } from '../open-conversation'
import type { CloudBridgeFactory } from '../use-cloud-lift'
import { spokenIn, until } from './app-fixture'
import type { FakeApp } from './fake-app'
import { FakeSessionDisk } from './fake-session-disk'

type Archive = NonNullable<Awaited<ReturnType<LiftWorkspaceCapture>>>

const MANIFEST: Archive['manifest'] = {
  version: 1,
  repository: { sourcePath: '/atlas/workspace', originPath: '/work' },
  activeId: 'main',
  activeRelativePath: '',
  trees: [
    {
      id: 'main',
      name: 'main',
      sourcePath: '/atlas/workspace',
      originPath: '/work',
      branch: 'main',
      head: null,
      baseline: null,
      fingerprint: 'fake',
      isMain: true,
    },
  ],
}

export const dummyArchive: LiftWorkspaceCapture = async () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-spec-archive-'))
  const path = join(directory, 'workspace.tar.gz')
  writeFileSync(path, 'a dummy workspace archive')
  return { path, manifest: MANIFEST, release: () => rm(directory, { recursive: true, force: true }) }
}

export const activatingAs = (args: { bridge: FakeBridge; cwd: string; replies: readonly boolean[] }): EClientRequest[] => {
  const seen: EClientRequest[] = []
  let asked = 0
  const attach = args.bridge.attach
  args.bridge.attach = (given) => {
    const attachment = attach(given)
    const request = attachment.channel.request
    attachment.channel.request = async (call) => {
      seen.push(call.op)
      if (call.op === EClientRequest.ApplyWorkspaceArchive) {
        return { applied: true, restored: { cwd: args.cwd, repository: args.cwd, trees: [] } }
      }
      if (call.op === EClientRequest.ActivateSession) {
        const reply = args.replies[Math.min(asked, args.replies.length - 1)] ?? true
        asked += 1
        return { activated: reply }
      }
      return request(call)
    }
    return attachment
  }
  return seen
}

export const mountCloud = async (args: {
  app: FakeApp
  bridge: FakeBridge
  opened?: OpenedConversation
  withArchive: boolean
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
      preflightLift={async () => null}
      captureWorkspace={async () => CLEAN_WORKSPACE}
      captureArchive={args.withArchive ? dummyArchive : async () => undefined}
      captureContext={async () => undefined}
      restoreWorkspace={async () => ({
        cwd: args.app.workspace.workspace,
        repository: args.app.workspace.workspace,
        trees: [],
      })}
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
        const candidate = node as { opacity?: unknown; id?: unknown; getChildren?: () => readonly unknown[] }
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
