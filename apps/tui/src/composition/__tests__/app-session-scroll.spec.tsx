import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, toRunId, type EventDraft } from '@dltech/atlas-core'
import { EChannelConnection, ECloudSandboxState } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { clearAttachFailure } from '../attach-failure'
import { App } from '../app'
import { CLEAN_WORKSPACE, fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory } from '../use-cloud-lift'
import { THREAD } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { FakeSessionDisk } from './fake-session-disk'

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const SIZE = { width: 140, height: 40, exitOnCtrlC: false }

const JUMP_PILL = 'jump to bottom'

const SOURCE_TAIL = 'SOURCE-TAIL-MARKER'
const DESTINATION_TAIL = 'DESTINATION-TAIL-MARKER'
const CLOUD_TAIL = 'CLOUD-TAIL-MARKER'
const LATER_SAID = 'CLOUD-LATER-MARKER'

const SHORT_PAIRS = 40
const WINDOWED_PAIRS = 130
const WHEEL_NOTCHES = 10

const RUNNING = { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' } as const

type Mounted = Awaited<ReturnType<typeof testRender>>

const appFor = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }) })

const conversationOf = (args: { label: string; pairs: number; tail: string }): EventDraft[] => {
  const drafts: EventDraft[] = []
  for (let pair = 0; pair < args.pairs; pair += 1) {
    drafts.push({ type: 'user-said', text: `${args.label} question ${pair}` })
    const filler = Array.from({ length: 4 }, (_, line) => `${args.label} answer ${pair} line ${line}`)
    drafts.push({ type: 'assistant-said', parts: [{ type: 'text', text: filler.join('\n\n') }] })
  }
  drafts.push({ type: 'user-said', text: `${args.label} closing question` })
  drafts.push({ type: 'assistant-said', parts: [{ type: 'text', text: args.tail }] })
  return drafts
}

async function seedDestination(args: { app: FakeApp; pairs: number }): Promise<void> {
  const thread = await args.app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await args.app.threads.rename({ threadId: thread.id, title: 'destination thread' })
  const drafts = conversationOf({ label: 'destination', pairs: args.pairs, tail: DESTINATION_TAIL })
  await args.app.log.append({ threadId: thread.id, runId: toRunId('run-destination'), drafts })
}

async function mountSeeded(args: { source: number; destination?: number }): Promise<Mounted> {
  const app = appFor()
  const events = await app.log.append({
    threadId: THREAD,
    runId: toRunId('run-source'),
    drafts: conversationOf({ label: 'source', pairs: args.source, tail: SOURCE_TAIL }),
  })
  if (args.destination !== undefined) await seedDestination({ app, pairs: args.destination })
  const opened = { threadId: THREAD, events, turns: [], name: null, started: true }
  const setup = await testRender(<App app={app} opened={opened} />, SIZE)
  await settle(250)
  await setup.flush()
  return setup
}

async function command(args: { setup: Mounted; text: string }): Promise<void> {
  await args.setup.mockInput.typeText(args.text)
  args.setup.mockInput.pressEnter()
  await settle(250)
  await args.setup.flush()
}

async function wheelUp(setup: Mounted): Promise<string> {
  for (let notch = 0; notch < WHEEL_NOTCHES; notch += 1) await setup.mockMouse.scroll(20, 5, 'up')
  await settle(120)
  return frameWhen({
    setup,
    holds: (frame) => frame.includes(JUMP_PILL),
    describe: 'the jump pill after scrolling up',
  })
}

async function readingHistory(args: { setup: Mounted; tail: string }): Promise<void> {
  await frameShowing({ setup: args.setup, text: args.tail })
  const frame = await wheelUp(args.setup)
  expect(frame).toContain(JUMP_PILL)
  expect(frame).not.toContain(args.tail)
}

async function landedAtEnd(args: { setup: Mounted; tail: string }): Promise<void> {
  await frameShowing({ setup: args.setup, text: args.tail })
  await settle(250)
  await args.setup.flush()
  const frame = args.setup.captureCharFrame()
  expect(frame).toContain(args.tail)
  expect(frame).not.toContain(JUMP_PILL)
}

type Scroller = {
  scrollTop: number
  scrollHeight: number
  viewport: { height: number }
  scrollTo: (offset: number) => void
}

const isScroller = (node: unknown): node is Scroller =>
  typeof node === 'object' && node !== null && 'scrollTo' in node && 'scrollHeight' in node && 'viewport' in node

const findScroller = (node: unknown): Scroller | null =>
  isScroller(node)
    ? node
    : ((node as { getChildren?: () => readonly unknown[] }).getChildren?.() ?? [])
        .map(findScroller)
        .find((found) => found !== null) ?? null

const scrollerOf = (setup: Mounted): Scroller => {
  const found = findScroller(setup.renderer.root)
  if (found === null) throw new Error('the transcript scrollbox never mounted')
  return found
}

const isAtBottom = (box: Scroller): boolean => box.scrollTop >= box.scrollHeight - box.viewport.height - 1

async function scrollWithin(args: { setup: Mounted; where: 'top' | 'middle' }): Promise<void> {
  const box = scrollerOf(args.setup)
  box.scrollTo(args.where === 'top' ? 0 : Math.floor(box.scrollHeight / 2))
  await settle(300)
  await args.setup.flush()
  expect(isAtBottom(scrollerOf(args.setup))).toBe(false)
}

describe.each([
  { name: 'a short transcript', pairs: SHORT_PAIRS },
  { name: 'a windowed transcript', pairs: WINDOWED_PAIRS },
])('opening a session from $name', ({ pairs }) => {
  it('shows its end', async () => {
    const setup = await mountSeeded({ source: pairs })

    try {
      await landedAtEnd({ setup, tail: SOURCE_TAIL })
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe.each([
  { name: 'windowed to short, from the head', source: 130, destination: 30, where: 'top' },
  { name: 'short to windowed, from the middle', source: 30, destination: 130, where: 'middle' },
  { name: 'deep windowed to windowed, from the head', source: 300, destination: 101, where: 'top' },
  { name: 'windowed to deeper, from the middle', source: 101, destination: 300, where: 'middle' },
  { name: 'near-equal windowed, from the head', source: 101, destination: 102, where: 'top' },
] as const)('picker resume, $name', ({ source, destination, where }) => {
  it('lands the destination at its end instead of retaining the source scroll position', async () => {
    const setup = await mountSeeded({ source, destination })

    try {
      await frameShowing({ setup, text: SOURCE_TAIL })
      await command({ setup, text: '/resume' })
      await scrollWithin({ setup, where })
      setup.mockInput.pressEnter()
      await setup.flush()

      await landedAtEnd({ setup, tail: DESTINATION_TAIL })
      expect(isAtBottom(scrollerOf(setup))).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

async function mountCloudThread(args: { pairs: number }) {
  const app = appFor()
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await app.threads.rename({ threadId: thread.id, title: 'the cloud thread' })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-cloud'),
    drafts: conversationOf({ label: 'cloud', pairs: args.pairs, tail: CLOUD_TAIL }),
  })

  const home = mkdtempSync(join(tmpdir(), 'atlas-session-scroll-spec-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const disk = new FakeSessionDisk(home)
  app.log.mirrorTo(disk)
  app.threads.mirrorTo(disk)
  const bridge = fakeBridge({ status: RUNNING })
  bridge.sourceStores({ log: app.log, threads: app.threads, workspace: app.workspace.workspace, disk })
  const createBridge: CloudBridgeFactory = () => bridge
  await disk.writeSessionMeta({ threadId: THREAD })
  await disk.stampProvenance({ threadId: THREAD, archiveDigest: null })

  const opened = { threadId: THREAD, events: [], turns: [], name: null, started: false, bootCloudThreadId: thread.id }
  const setup = await testRender(
    <App
      app={app}
      opened={opened}
      createBridge={createBridge}
      preflightLift={async () => null}
      captureWorkspace={async () => CLEAN_WORKSPACE}
      captureArchive={async () => undefined}
      captureContext={async () => undefined}
      restoreWorkspace={async () => ({ cwd: app.workspace.workspace, repository: app.workspace.workspace, trees: [] })}
    />,
    SIZE,
  )

  return {
    setup,
    bridge,
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    },
  }
}

const VOUCHED = { turnInFlight: false, transcriptCurrent: true } as const

async function reconnect({ bridge, setup }: { bridge: FakeBridge; setup: Mounted }): Promise<void> {
  bridge.channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
  await settle(120)
  await setup.flush()
  bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
  bridge.channel.ready(VOUCHED)
}

async function attachedAtEnd({ setup, bridge }: { setup: Mounted; bridge: FakeBridge }): Promise<void> {
  await frameShowing({ setup, text: CLOUD_TAIL, within: 20_000 })
  bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
  bridge.channel.ready(VOUCHED)
  await landedAtEnd({ setup, tail: CLOUD_TAIL })
}

describe.each([
  { name: 'a short transcript', pairs: SHORT_PAIRS },
  { name: 'a windowed transcript', pairs: WINDOWED_PAIRS },
])('a cloud session with $name', ({ pairs }) => {
  it('returns to the end each time the socket reconnects', async () => {
    const { setup, bridge, done } = await mountCloudThread({ pairs })

    try {
      await attachedAtEnd({ setup, bridge })

      await readingHistory({ setup, tail: CLOUD_TAIL })
      await reconnect({ bridge, setup })
      await landedAtEnd({ setup, tail: CLOUD_TAIL })

      await readingHistory({ setup, tail: CLOUD_TAIL })
      await reconnect({ bridge, setup })
      await landedAtEnd({ setup, tail: CLOUD_TAIL })
    } finally {
      await done()
    }
  }, 90_000)

  it('leaves a reader in history while the socket stays open', async () => {
    const { setup, bridge, done } = await mountCloudThread({ pairs })

    try {
      await attachedAtEnd({ setup, bridge })

      await readingHistory({ setup, tail: CLOUD_TAIL })
      bridge.channel.ready(VOUCHED)
      bridge.channel.commitSaid({ text: LATER_SAID })
      await settle(400)
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain(JUMP_PILL)
      expect(frame).not.toContain(CLOUD_TAIL)
      expect(frame).not.toContain(LATER_SAID)
    } finally {
      await done()
    }
  }, 90_000)
})
