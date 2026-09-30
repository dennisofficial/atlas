import { beforeEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, RemoteThreadStore } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort } from './fake-app'
import { mirrorCloudRenames } from '../cloud/rename-mirror'

await grammarsReady()

beforeEach(() => {
  dismissNotice()
})

const RUNNING_STATUS = {
  state: ECloudSandboxState.Running,
  url: 'https://sandbox.example/thread',
} as const

const remoteFor = (args: {
  app: ReturnType<typeof fakeApp>
  bridge: ReturnType<typeof fakeBridge>
  threadId: ThreadId
}): RemoteThreadStore => {
  args.bridge.sourceStores({
    log: args.app.log,
    threads: args.app.threads,
    workspace: args.app.workspace.workspace,
  })
  const attachment = args.bridge.attach({
    threadId: args.threadId,
    url: RUNNING_STATUS.url,
    token: 'tok',
  })
  return new RemoteThreadStore({ channel: attachment.channel })
}

describe('a rename the sandbox announces', () => {
  it('lands in the local thread store, so a name-based resume resolves after a restart', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      names: null,
    })
    const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    const remote = remoteFor({ app, bridge, threadId: thread.id })

    const detach = mirrorCloudRenames({ home: app.threads, remote })
    expect(typeof detach).toBe('function')

    bridge.channel.pushThreadRenamed({ threadId: thread.id, title: 'Atlas Repository Setup' })

    expect(
      await until({
        holds: async () =>
          (
            await app.threads.findNamed({
              project: FAKE_CONFIG.cwd,
              handle: 'atlas-repository-setup',
            })
          )?.id === thread.id,
        within: 10_000,
      }),
    ).toBe(true)

    detach()
  })

  it('keeps the latest name when the sandbox renames more than once', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      names: null,
    })
    const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    const remote = remoteFor({ app, bridge, threadId: thread.id })

    const detach = mirrorCloudRenames({ home: app.threads, remote })

    bridge.channel.pushThreadRenamed({ threadId: thread.id, title: 'second name' })
    bridge.channel.pushThreadRenamed({ threadId: thread.id, title: 'third name' })

    expect(
      await until({
        holds: async () => (await app.threads.find({ threadId: thread.id }))?.title === 'third name',
        within: 10_000,
      }),
    ).toBe(true)

    detach()
  })
})
