import { beforeEach, describe, expect, it } from 'bun:test'

import { TextareaRenderable, type Renderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'

import { EEffort, EExecutionLocation, refKey, toRunId, type ThreadId } from '@dltech/atlas-core'
import { EClientRequest, ECloudSandboxState, RemoteRequestFailed } from '@dltech/atlas-harness'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { CLEAN_WORKSPACE, fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory } from '../use-cloud-lift'
import { spokenIn, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

beforeEach(() => {
  dismissNotice()
})

const WIDE = { width: 140, height: 40 }

const RUNNING_STATUS = {
  state: ECloudSandboxState.Running,
  url: 'https://sandbox.example/thread',
} as const

const speaking = (): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    names: null,
  })

const seedCloudThread = async (app: FakeApp): Promise<{ threadId: ThreadId }> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({
    threadId: thread.id,
    location: EExecutionLocation.Cloud,
  })
  await app.threads.rename({ threadId: thread.id, title: 'the lifted thread' })
  return { threadId: thread.id }
}

const mount = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  args.bridge.sourceStores({
    log: args.app.log,
    threads: args.app.threads,
    workspace: args.app.workspace.workspace,
  })
  const createBridge: CloudBridgeFactory = () => args.bridge
  const setup = await testRender(
    <App
      app={args.app}
      opened={await spokenIn(args.app)}
      createBridge={createBridge}
      preflightLift={async () => null}
      captureWorkspace={async () => CLEAN_WORKSPACE}
      captureContext={async () => undefined}
    />,
    WIDE,
  )

  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }

  return {
    app: args.app,
    frame,
    typeText: (text: string) => setup.mockInput.typeText(text),
    pressEnter: () => setup.mockInput.pressEnter(),
    pressCtrl: (key: string) => setup.mockInput.pressKey(key, { ctrl: true }),
    pressUp: () => setup.mockInput.pressArrow('up'),
    click: (x: number, y: number) => setup.mockMouse.click(x, y),
    composerText: () => {
      let found: string | null = null
      const visit = (node: unknown): void => {
        if (node instanceof TextareaRenderable) {
          found = node.plainText
          return
        }
        for (const child of (node as Renderable).getChildren?.() ?? []) visit(child)
      }
      visit(setup.renderer.root)
      return found
    },
    command: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      return frame()
    },
    pick: async () => {
      setup.mockInput.pressEnter()
      return frame()
    },
    done: () => teardown(setup),
  }
}

const openCloudConversation = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  const mounted = await mount({ app: args.app, bridge: args.bridge })
  await mounted.command('/resume')
  await mounted.pick()
  expect(
    await until({ holds: async () => args.bridge.attached.length === 1, within: 10_000 }),
  ).toBe(true)
  args.bridge.channel.announce()
  await mounted.frame()
  return mounted
}

describe('a conversation that lives in the cloud', () => {
  it('repaints the footer model when the sandbox announces a model change', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await openCloudConversation({ app, bridge })

    try {
      expect(refKey(app.model.choice().ref)).toBe('anthropic/claude-haiku-4-5')

      bridge.channel.pushThreadModelChanged({
        threadId,
        model: { ref: 'anthropic/claude-opus-5', effort: EEffort.High },
      })

      expect(
        await until({
          holds: async () => refKey(app.model.choice().ref) === 'anthropic/claude-opus-5',
          within: 10_000,
        }),
      ).toBe(true)
      expect(app.model.choice().effort).toBe(EEffort.High)
      expect((await mounted.frame()).toLowerCase()).toContain('opus')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('repaints the thread name when the sandbox announces a rename', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await openCloudConversation({ app, bridge })

    try {
      bridge.channel.pushThreadRenamed({ threadId, title: 'titled by the sandbox' })

      expect(
        await until({
          holds: async () => (await mounted.frame()).includes('titled by the sandbox'),
          within: 10_000,
        }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('mirrors a sandbox-announced rename into the home store, so a restarted resume resolves it by name', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await openCloudConversation({ app, bridge })

    try {
      bridge.channel.pushThreadRenamed({ threadId, title: 'Titled By The Sandbox' })

      expect(
        await until({
          holds: async () =>
            (
              await app.threads.findNamed({
                project: FAKE_CONFIG.cwd,
                handle: 'titled-by-the-sandbox',
              })
            )?.id === threadId,
          within: 10_000,
        }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('sends the rename op over the channel when the operator renames', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await openCloudConversation({ app, bridge })

    try {
      await mounted.typeText('/rename a name from the laptop ')
      await mounted.frame()
      mounted.pressEnter()
      await settle(500)

      const renamed = await until({
        holds: async () => {
          await mounted.frame()
          return bridge.channel.requests.some(({ op }) => op === EClientRequest.RenameThread)
        },
        within: 10_000,
      })
      expect(renamed).toBe(true)

      const sent = bridge.channel.requests.find(({ op }) => op === EClientRequest.RenameThread)
      expect(sent?.params).toEqual({ threadId, title: 'a name from the laptop' })

      expect(
        await until({
          holds: async () => (await mounted.frame()).includes('a name from the laptop'),
          within: 10_000,
        }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('a cloud model write the sandbox refuses', () => {
  it('posts a notice and reverts the selection the picker had already shown', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await openCloudConversation({ app, bridge })

    try {
      const prior = app.model.choice()
      const channel = bridge.channel
      channel.request = () =>
        Promise.reject(
          new RemoteRequestFailed({
            op: EClientRequest.SetThreadModel,
            data: 'unknown op set-thread-model',
          }),
        )

      mounted.pressCtrl('p')
      await settle(1_000)
      const opened = await mounted.frame()
      const lines = opened.split('\n')
      const row = lines.findIndex((line) => line.includes('sonnet-5'))
      const line = lines[row] ?? ''
      const column = line.indexOf('sonnet-5')
      expect(row).toBeGreaterThan(-1)
      await mounted.click(column, row)
      await settle(500)
      await mounted.frame()
      mounted.pressEnter()
      await settle(100)

      const reverted = await until({
        holds: async () => {
          await mounted.frame()
          return (
            currentNotices().some((notice) =>
              notice.text.includes("didn't reach the cloud session"),
            ) && refKey(app.model.choice().ref) === refKey(prior.ref)
          )
        },
        within: 10_000,
      })
      expect(reverted).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
