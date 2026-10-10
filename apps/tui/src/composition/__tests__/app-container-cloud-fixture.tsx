import React from 'react'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'

import type { ClipboardImageReader } from '../../ui/clipboard-image'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { CLEAN_WORKSPACE, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory, LiftPreflight, WorkspaceCapture } from '../use-cloud-lift'
import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import type { OpenedConversation } from '../open-conversation'
import { editorIn, spokenIn, REPLY, THINKING, THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { FakeSessionDisk } from './fake-session-disk'

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

export const SEEDED = 'what is in here?'

const SANDBOX_WORKSPACE = '/atlas/workspaces/sandbox-checkout'

/**
 * The /resume picker lists the local store, so a conversation that lives in the cloud is seeded
 * there as a cloud thread — the row that says where it runs — while its transcript stays in the
 * sandbox's stores, which the fake bridge serves.
 */
export const seedCloudThread = async (args: {
  app: FakeApp
  threadId?: ThreadId
  title?: string
}): Promise<{ threadId: ThreadId }> => {
  const thread = await args.app.threads.create({
    workspace: FAKE_CONFIG.cwd,
    repo: null,
    ...(args.threadId === undefined ? {} : { id: args.threadId }),
  })
  await args.app.threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await args.app.threads.rename({ threadId: thread.id, title: args.title ?? 'the lifted thread' })
  return { threadId: thread.id }
}

export const mount = async (args: {
  app: FakeApp
  bridge: FakeBridge
  opened?: OpenedConversation
  preflightLift?: LiftPreflight
  clipboard?: ClipboardImageReader
}) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-cloud-spec-'))
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
      preflightLift={args.preflightLift ?? (async () => null)}
      captureWorkspace={DIRTY}
      captureArchive={async () => undefined}
      restoreWorkspace={async () => ({ cwd: args.app.workspace.workspace, repository: args.app.workspace.workspace, trees: [] })}
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
    /**
     * `replaceText` fires the editor's change event, which mirrors the emptied buffer into React
     * and closes the command menu a trailing `/…` opened — backspaces through the editor would
     * leave the menu's `typed` ref stale.
     */
    clearDraft: () => editorIn(setup.renderer.root)?.replaceText(''),
    pressEnter: () => setup.mockInput.pressEnter(),
    pressUp: () => setup.mockInput.pressArrow('up'),
    pressEscape: () => setup.mockInput.pressEscape(),
    pressCtrl: (key: string) => setup.mockInput.pressKey(key, { ctrl: true }),
    pressCtrlC: () => setup.mockInput.pressKey('c', { ctrl: true }),
    draftText: () => editorIn(setup.renderer.root)?.plainText ?? null,
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    },
  }
}

export const cloudOpened = async (args: { app: FakeApp; bridge: FakeBridge }): Promise<OpenedConversation> => {
  const { threadId } = await seedCloudThread({ app: args.app, threadId: THREAD })
  await args.bridge.log.append({
    threadId,
    runId: toRunId('run-cloud'),
    drafts: [
      { type: 'user-said', text: SEEDED },
      {
        type: 'location-changed',
        from: EExecutionLocation.Host,
        to: EExecutionLocation.Cloud,
        cwd: SANDBOX_WORKSPACE,
      },
    ],
  })
  return { threadId: THREAD, events: [], turns: [], name: null, started: false, bootCloudThreadId: threadId }
}

/** A session that opens on a thread born in the cloud, attaching at boot the way a relaunch does. */
export const mountInCloud = async (args: {
  app: FakeApp
  bridge: FakeBridge
  clipboard?: ClipboardImageReader
}) => {
  const opened = await cloudOpened({ app: args.app, bridge: args.bridge })
  const mounted = await mount({ ...args, opened })
  const attached = await until({ holds: async () => args.bridge.attached.length === 1, within: 20_000 })
  if (!attached) {
    await mounted.done()
    throw new Error('the boot attach never reached the sandbox')
  }
  return mounted
}

type Mounted = Awaited<ReturnType<typeof mount>>

export const nextFrameOf = async (mounted: Mounted): Promise<string> => {
  try {
    return await mounted.nextFrame()
  } catch (error) {
    if (error instanceof Error && error.message.includes('visual idle')) return ''
    throw error
  }
}

const frameHolding = async (args: {
  mounted: Mounted
  holds: (frame: string) => boolean
  what: string
}): Promise<string> => {
  const deadline = Date.now() + 20_000
  let frame = ''
  while (Date.now() < deadline) {
    frame = await nextFrameOf(args.mounted)
    if (args.holds(frame)) return frame
    await settle(10)
  }
  throw new Error(`waited past 20000 ms for ${args.what}\n\n${frame}`)
}

export const shown = (mounted: Mounted, text: string): Promise<string> =>
  frameHolding({ mounted, holds: (frame) => frame.includes(text), what: JSON.stringify(text) })

export const cleared = (mounted: Mounted, text: string): Promise<string> =>
  frameHolding({
    mounted,
    holds: (frame) => !frame.includes(text),
    what: `${JSON.stringify(text)} to go away`,
  })
