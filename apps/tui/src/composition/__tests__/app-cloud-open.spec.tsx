import { beforeEach, describe, expect, it } from 'bun:test'

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import React from 'react'
import { testRender } from '@opentui/react/test-utils'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'

import { frameShowing } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { ECloudSandboxState, SessionsClient } from '@dltech/atlas-harness'
import { CLEAN_WORKSPACE, fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory } from '../use-cloud-lift'
import { spokenIn, THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, fakeCloud, scriptedModelPort, type FakeApp } from './fake-app'
import { FakeSessionDisk } from './fake-session-disk'

await grammarsReady()

beforeEach(() => {
  dismissNotice()
})

const WIDE = { width: 140, height: 40 }

const RUNNING_STATUS = {
  state: ECloudSandboxState.Running,
  url: 'https://sandbox.example/thread',
} as const

const RESUMED_SANDBOX = {
  url: 'https://sandbox.example/thread',
  token: 'sandbox-token',
  state: ECloudSandboxState.Running,
  created: false,
} as const

const speaking = (): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cloud: fakeCloud({
      sessionsClientFor: ({ session }) =>
        new SessionsClient({
          url: session.url,
          token: session.token,
          fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
        }),
    }),
  })

/**
 * The /resume picker lists the local store, so a conversation that lives in the cloud is seeded
 * there as a cloud thread — the row that says where it runs — while its transcript stays in the
 * sandbox's stores, which the fake bridge serves.
 */
const seedCloudThread = async (
  app: FakeApp,
): Promise<{ threadId: ThreadId }> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await app.threads.rename({ threadId: thread.id, title: 'the lifted thread' })
  return { threadId: thread.id }
}

const mount = async (args: {
  app: FakeApp
  bridge: FakeBridge
  opened?: Parameters<typeof App>[0]['opened']
  onRestart?: () => void
}) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-cloud-open-spec-'))
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
      captureContext={async () => undefined}
      {...(args.onRestart === undefined ? {} : { onRestart: args.onRestart })}
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
    frame,
    showing: (text: string) => frameShowing({ setup, text }),
    command: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      return frame()
    },
    pick: async () => {
      setup.mockInput.pressEnter()
      return frame()
    },
    typeText: (text: string) => setup.mockInput.typeText(text),
    done: async () => {
      await teardown(setup)
      if (previousHome === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previousHome
    },
  }
}

describe('opening a conversation that lives in the cloud', () => {
  it('attaches to its sandbox when picked from /resume', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.command('/resume')
      await mounted.typeText('lifted')
      await mounted.pick()

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(
        true,
      )
      const frame = await mounted.frame()

      expect(bridge.created).toHaveLength(1)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
      expect(frame).toContain('said inside the sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('attaches when /resume names a cloud conversation by the title the cloud remembers', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.command('/resume the-lifted-thread')

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(
        true,
      )
      const frame = await mounted.frame()

      expect(bridge.attached[0]?.threadId).toBe(threadId)
      expect(frame).toContain('said inside the sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('attaches at boot when the session opens on a cloud conversation', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({
      app,
      bridge,
      opened: {
        threadId: THREAD,
        events: [],
        turns: [],
        name: null,
        started: false,
        bootCloudThreadId: threadId,
      },
    })

    try {
      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(
        true,
      )
      const frame = await mounted.frame()

      expect(bridge.created).toHaveLength(1)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
      expect(frame).toContain('said inside the sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the meta saying cloud and warns when the boot attach fails', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS, createFails: new Error('the sandbox could not wake') })
    const mounted = await mount({
      app,
      bridge,
      opened: {
        threadId: THREAD,
        events: [],
        turns: [],
        name: null,
        started: false,
        bootCloudThreadId: threadId,
      },
    })

    try {
      const warned = await until({
        holds: async () =>
          currentNotices().some((notice) => notice.text.includes('the sandbox could not wake')),
        within: 10_000,
      })
      expect(warned).toBe(true)
      expect((await app.threads.find({ threadId }))?.executionLocation).toBe(
        EExecutionLocation.Cloud,
      )
    } finally {
      await mounted.done()
    }
  }, 60_000)
})


describe('the picker badge and the reattach notice', () => {
  it('badges a cloud conversation with its sandbox state in the picker', async () => {
    const app = speaking()
    await seedCloudThread(app)
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    const mounted = await mount({ app, bridge })

    try {
      const frame = await mounted.command('/resume')

      expect(frame).toContain('the lifted thread')
      expect(frame).toContain('☁ running')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('says what survived once the reattached sandbox greets', async () => {
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({
      status: RUNNING_STATUS,
      sandbox: RESUMED_SANDBOX,
    })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.command('/resume')
      await mounted.typeText('lifted')
      await mounted.pick()

      bridge.channel.ready({ turnInFlight: true })
      const frame = await mounted.frame()

      expect(frame).toContain('reattached')
      expect(frame).toContain('as you left them')
      expect(frame).toContain('the turn kept running')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('coming back to the host', () => {
  it('descends when a local conversation is picked from inside a cloud session', async () => {
    const app = speaking()
    const hostThread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: hostThread.id, title: 'the host thread' })
    await app.log.append({
      threadId: hostThread.id,
      runId: toRunId('run-host'),
      drafts: [{ type: 'user-said', text: 'said on the host' }],
    })
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.command('/container cloud')
      await mounted.showing('☁ cloud')
      await mounted.command('/resume')
      await mounted.showing('the host thread')
      await mounted.typeText('host')
      await mounted.pick()
      const frame = await mounted.showing('said on the host')

      expect(frame).toContain('said on the host')
      expect(bridge.channel.closed).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('/restart on a cloud session', () => {
  it('restarts immediately without asking about tasks', async () => {
    let restarts = 0
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ threadStore: app.threads, status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({
      app,
      bridge,
      onRestart: () => {
        restarts += 1
      },
    })

    try {
      await mounted.command('/resume')
      await mounted.typeText('lifted')
      await mounted.pick()

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(
        true,
      )

      bridge.channel.ready({ turnInFlight: false })
      await mounted.frame()

      await mounted.command('/restart')

      expect(restarts).toBe(1)
      expect(bridge.channel.closed).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('restarts mid-turn rather than queuing for the sandbox to settle', async () => {
    let restarts = 0
    const app = speaking()
    const { threadId } = await seedCloudThread(app)
    const bridge = fakeBridge({ threadStore: app.threads, status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({
      app,
      bridge,
      onRestart: () => {
        restarts += 1
      },
    })

    try {
      await mounted.command('/resume')
      await mounted.typeText('lifted')
      await mounted.pick()

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(
        true,
      )

      bridge.channel.ready({ turnInFlight: true })
      await mounted.frame()

      await mounted.command('/restart')

      expect(restarts).toBe(1)
      expect(bridge.channel.closed).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
