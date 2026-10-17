import React from 'react'

import { testRender } from '@opentui/react/test-utils'

import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import {
  composeHarness,
  inProcessPortBindings,
  type CloudBridge,
  type CloudChannel,
  type CloudSandboxes,
  type SettingsBinding,
} from '@dltech/atlas-harness'

import { App } from '../../src/composition/app'
import { createCloudBridge } from '../../src/composition/cloud/create-bridge'
import type { AtlasApp } from '../../src/composition/compose'
import { EOpenMode } from '../../src/composition/config'
import { liveBridgeOptionsFor } from '../../src/composition/live-cloud'
import { noticePortBinding } from '../../src/composition/notice-binding'
import {
  closeConversation,
  unstartedConversation,
  type OpenedConversation,
} from '../../src/composition/open-conversation'
import type { ContributedSurface, PluginSurface } from '../../src/plugins/surface'
import { frameShowing } from '../../src/ui/__tests__/waiting'
import { grammarsReady, teardown } from '../../src/ui/markdown/__tests__/harness'
import { tldrFeed } from '../../src/ui/tldr-feed-store'

export type RigApp = {
  app: AtlasApp
  threadId: ThreadId
  channel: () => CloudChannel | null
  cloudLog: () => EventLogPort | null
  frame: () => Promise<string>
  type: (text: string) => Promise<void>
  submit: (text: string) => Promise<void>
  driverLines: string[]
  close: () => Promise<void>
}

type Setup = Awaited<ReturnType<typeof testRender>>

const RIG_COMMAND = 'atlas-live-rig'
const BUSY_RENDERER = 'visual idle'
const CHIP_WITHIN_MS = 20_000
const LOCAL_CHIP = 'local ▾'
const CLOUD_CHIP = '☁ cloud ▾'

const flushTolerant = async (setup: Setup): Promise<void> => {
  try {
    await setup.flush()
  } catch (error) {
    if (!(error instanceof Error && error.message.includes(BUSY_RENDERER))) throw error
  }
}

const composeRigApp = async (args: { workspace: string; settings: SettingsBinding }): Promise<AtlasApp> => {
  const harness = await composeHarness<undefined, never, PluginSurface>({
    launch: { cwd: args.workspace, command: RIG_COMMAND, model: undefined, executionLocation: undefined },
    env: process.env,
    settings: args.settings,
    clientVersion: RIG_COMMAND,
    ports: inProcessPortBindings,
    surface: { notice: noticePortBinding(), tldrFeed },
  })
  const surfaces: readonly ContributedSurface[] = harness.pluginSurfaces
  return {
    ...harness,
    pluginProjections: harness.pluginProjections,
    pluginSurfaces: surfaces,
    pullRequests: null,
    prEventSink: null,
    config: { model: undefined, executionLocation: undefined, open: { mode: EOpenMode.New }, cwd: args.workspace },
    command: RIG_COMMAND,
  }
}

const resumedConversation = (threadId: ThreadId): OpenedConversation => ({
  threadId,
  events: [],
  turns: [],
  name: null,
  started: true,
})

const flipChipToCloud = async (setup: Setup): Promise<void> => {
  await frameShowing({ setup, text: LOCAL_CHIP, within: CHIP_WITHIN_MS })
  setup.mockInput.pressArrow('down')
  await flushTolerant(setup)
  setup.mockInput.pressEnter()
  await flushTolerant(setup)
  await frameShowing({ setup, text: CLOUD_CHIP, within: CHIP_WITHIN_MS })
}

export async function mountRig(args: {
  workspace: string
  settings: SettingsBinding
  resumeThreadId?: ThreadId | undefined
  onBirth?: ((threadId: ThreadId) => Promise<void> | void) | undefined
}): Promise<RigApp> {
  const app = await composeRigApp({ workspace: args.workspace, settings: args.settings })

  const driverLines: string[] = []
  let channel: CloudChannel | null = null
  let cloudLog: EventLogPort | null = null
  let bornThreadId: ThreadId | null = null
  const births = new Map<ThreadId, Promise<void>>()
  let setup: Setup | undefined
  let closing: Promise<void> | undefined

  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        if (setup !== undefined) await teardown(setup)
      } finally {
        try {
          await closeConversation()
        } finally {
          await app.close()
        }
      }
    })()
    return closing
  }

  const options = liveBridgeOptionsFor(app)
  const inner = createCloudBridge({
    ...options,
    onDriverLog: (line) => {
      driverLines.push(line)
      options.onDriverLog?.(line)
    },
  })
  const sandboxes: CloudSandboxes = {
    ...inner.sandboxes,
    create: async (createArgs) => {
      bornThreadId ??= createArgs.threadId
      const birth = births.get(createArgs.threadId) ?? Promise.resolve(args.onBirth?.(createArgs.threadId))
      births.set(createArgs.threadId, birth)
      await birth
      return inner.sandboxes.create(createArgs)
    },
  }
  const bridge: CloudBridge = {
    sandboxes,
    attach: (attachArgs) => {
      const attachment = inner.attach(attachArgs)
      channel = attachment.channel
      cloudLog = attachment.stores.log
      return attachment
    },
  }

  const opened =
    args.resumeThreadId === undefined
      ? unstartedConversation({ ids: app.ids })
      : resumedConversation(args.resumeThreadId)

  try {
    await grammarsReady()
    setup = await testRender(<App app={app} opened={opened} createBridge={() => bridge} />, {
      width: 140,
      height: 40,
      exitOnCtrlC: false,
    })
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    if (args.resumeThreadId === undefined) await flipChipToCloud(setup)
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }

  const mounted = setup
  const type = async (text: string): Promise<void> => {
    await mounted.mockInput.typeText(text)
    await flushTolerant(mounted)
  }

  return {
    app,
    get threadId(): ThreadId {
      return bornThreadId ?? opened.threadId
    },
    channel: () => channel,
    cloudLog: () => cloudLog,
    frame: async () => {
      await flushTolerant(mounted)
      return mounted.captureCharFrame()
    },
    type,
    submit: async (text) => {
      await type(text)
      mounted.mockInput.pressEnter()
      await flushTolerant(mounted)
    },
    driverLines,
    close,
  }
}
