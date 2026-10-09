import React from 'react'

import { testRender } from '@opentui/react/test-utils'

import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  captureLiftWorkspace,
  captureWorkspaceMetadata,
  composeHarness,
  ELiftNode,
  type CaptureContext,
  type CloudBridge,
  type SettingsBinding,
} from '@dltech/atlas-harness'

import { EDescendNode } from '../../../../packages/harness/src/cloud/relocation/descend-plan'
import { App } from '../../src/composition/app'
import type { AtlasApp } from '../../src/composition/compose'
import { EOpenMode } from '../../src/composition/config'
import { closeConversation } from '../../src/composition/open-conversation'
import { noticePortBinding } from '../../src/composition/notice-binding'
import type { ContributedSurface, PluginSurface } from '../../src/plugins/surface'
import { currentNotices, subscribeNotices } from '../../src/ui/notice-store'
import { tldrFeed } from '../../src/ui/tldr-feed-store'
import { frameShowing } from '../../src/ui/__tests__/waiting'
import { grammarsReady, teardown } from '../../src/ui/markdown/__tests__/harness'
import { createCommandWait, moveFailureOf, type CommandOutcome, type CommandWait } from './command-wait'
import { openNormalizedRoot } from './mount-fixture'
import { measured, type BenchmarkEntry } from './timing'

export type BenchmarkCommand = '/container cloud' | '/container host'

export type CloudBenchmark = {
  app: AtlasApp
  command: (text: BenchmarkCommand) => Promise<CommandOutcome>
  frame: () => Promise<string>
  close: () => Promise<void>
}

const SERVE_COMMAND = 'serve'
const COMMAND_TIMEOUT_MS = 5 * 60_000
const TYPED_COMMAND_WITHIN_MS = 10_000
const PUMP_MS = 25
const BUSY_RENDERER = 'visual idle'

const LIFT_STEPS: readonly string[] = [
  ELiftNode.FlipOwnership,
  ELiftNode.ActivateFamily,
  ELiftNode.DestroyLocalWorktree,
]

const DESCEND_STEPS: readonly string[] = [
  EDescendNode.PrepareWorkspace,
  EDescendNode.ReopenLocal,
  EDescendNode.FlipHome,
  EDescendNode.ActivateChildren,
  EDescendNode.DestroySandbox,
]

const COMMANDS: Record<BenchmarkCommand, { target: EExecutionLocation; steps: readonly string[] }> = {
  '/container cloud': { target: EExecutionLocation.Cloud, steps: LIFT_STEPS },
  '/container host': { target: EExecutionLocation.Host, steps: DESCEND_STEPS },
}

const isBenchmarkCommand = (text: string): text is BenchmarkCommand => text in COMMANDS

const flushTolerant = async (setup: { flush: () => Promise<void> }): Promise<void> => {
  try {
    await setup.flush()
  } catch (error) {
    if (!(error instanceof Error && error.message.includes(BUSY_RENDERER))) throw error
  }
}

export async function mountCloudBenchmark(args: {
  cwd: string
  threadId: ThreadId
  threadIds: readonly ThreadId[]
  settings: SettingsBinding
  bridgeFor: (app: AtlasApp) => CloudBridge
  record: (entry: BenchmarkEntry) => void
  captureContext?: CaptureContext | undefined
}): Promise<CloudBenchmark> {
  const { cwd, record } = args
  const harness = await composeHarness<undefined, never, PluginSurface>({
    launch: { cwd, command: SERVE_COMMAND, model: undefined, executionLocation: EExecutionLocation.Host },
    env: process.env,
    settings: args.settings,
    clientVersion: SERVE_COMMAND,
    surface: { notice: noticePortBinding(), tldrFeed },
  })

  let setup: Awaited<ReturnType<typeof testRender>> | undefined
  let active: CommandWait | undefined
  let closing: Promise<void> | undefined

  const surfaces: readonly ContributedSurface[] = harness.pluginSurfaces
  const app: AtlasApp = {
    ...harness,
    pluginProjections: harness.pluginProjections,
    pluginSurfaces: surfaces,
    pullRequests: null,
    prEventSink: null,
    config: { model: undefined, executionLocation: undefined, open: { mode: EOpenMode.New }, cwd },
    command: SERVE_COMMAND,
  }

  const close = (): Promise<void> => {
    closing ??= (async () => {
      active?.dispose()
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

  try {
    const opened = await openNormalizedRoot({
      harness,
      cwd,
      threadId: args.threadId,
      threadIds: args.threadIds,
      record,
    })

    await grammarsReady()
    const bridge = args.bridgeFor(app)
    setup = await testRender(
      <App
        app={app}
        opened={opened}
        createBridge={() => bridge}
        captureWorkspace={(capture) =>
          measured({ name: 'capture-workspace-metadata', record, run: () => captureWorkspaceMetadata(capture) })
        }
        captureArchive={(capture) =>
          measured({ name: 'capture-workspace-archive', record, run: () => captureLiftWorkspace(capture) })
        }
        {...(args.captureContext === undefined ? {} : { captureContext: args.captureContext })}
        onMoveStep={(timing) => {
          const recorded = active?.step(timing.step)
          if (recorded !== undefined) record({ phase: 'step-completed', ...recorded })
        }}
      />,
      { width: 140, height: 40, exitOnCtrlC: false },
    )
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }

  const mounted = setup

  const frame = async (): Promise<string> => {
    await flushTolerant(mounted)
    return mounted.captureCharFrame()
  }

  const pumpUntilSettled = async (completion: Promise<unknown>): Promise<void> => {
    let settled = false
    const done = completion
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        settled = true
      })
    while (!settled) {
      await flushTolerant(mounted)
      let timer: ReturnType<typeof setTimeout> | undefined
      const tick = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PUMP_MS)
      })
      await Promise.race([done, tick])
      clearTimeout(timer)
    }
  }

  const command = async (text: BenchmarkCommand): Promise<CommandOutcome> => {
    if (!isBenchmarkCommand(text)) throw new Error('the benchmark only types /container cloud or /container host')
    if (active !== undefined) throw new Error('a benchmark command is already running')

    const { target, steps } = COMMANDS[text]
    const wait = createCommandWait({
      target,
      requiredSteps: steps,
      owner: app.sessionOwner,
      notices: { subscribe: subscribeNotices, current: currentNotices },
      failureOf: moveFailureOf,
      timeoutMs: COMMAND_TIMEOUT_MS,
    })
    active = wait
    try {
      await mounted.mockInput.typeText(text)
      await frameShowing({ setup: mounted, text, within: TYPED_COMMAND_WITHIN_MS })
      record({ phase: 'command-start', command: text })
      wait.start()
      mounted.mockInput.pressEnter()
      await pumpUntilSettled(wait.completion)
      const outcome = await wait.completion
      record({ phase: 'command-settled', command: text, elapsedMs: outcome.elapsedMs })
      return outcome
    } catch (error) {
      record({
        phase: 'command-failed',
        command: text,
        message: error instanceof Error ? error.message : 'unknown failure',
      })
      throw error
    } finally {
      wait.dispose()
      active = undefined
    }
  }

  return { app, command, frame, close }
}
