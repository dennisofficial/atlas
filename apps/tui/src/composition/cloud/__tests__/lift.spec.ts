import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import { CloudError } from '@dltech/atlas-harness'

import { fakeEventLog, type FakeThreadStore } from '../../__tests__/fake-backend'
import { ECloudSandboxState } from '../cloud-bridge'
import { ELiftFault, ELiftStep, liftToCloud } from '../lift'
import { CLOUD_NOTICE_KEY } from '../transition-notice'
import { CLEAN_WORKSPACE, CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('lifting a conversation into the cloud', () => {
  it('stops what is running here, transfers the log, flips the thread and only then attaches', async () => {
    const test = harness()

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
    expect(test.steps).toEqual([
      ELiftStep.Stopping,
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELiftStep.Capturing,
      ELiftStep.Starting,
      ELiftStep.Attaching,
    ])
  })

  it('carries the whole local log across in one batch', async () => {
    const test = harness()

    await liftToCloud(test.args)

    const transferred = test.bridge.log.peek({ threadId: CLOUD_THREAD })
    expect(
      transferred.filter((event) => event.type === 'user-said').map((event) => event.seq),
    ).toEqual([1, 2])
  })

  it('records the thread as a cloud thread on both sides', async () => {
    const test = harness()

    await liftToCloud(test.args)

    expect(test.located).toEqual([EExecutionLocation.Cloud])
    expect(test.localThreads.chosenLocations).toEqual([
      { threadId: CLOUD_THREAD, location: EExecutionLocation.Cloud },
    ])
  })

  it('attaches to the sandbox the control plane handed back', async () => {
    const test = harness()

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')
    if (lifted.sandbox.url === undefined) throw new Error('expected the sandbox to carry a url')

    expect(test.bridge.attached).toEqual([
      { threadId: CLOUD_THREAD, url: lifted.sandbox.url, token: lifted.sandbox.token },
    ])
  })

  it('attaches once the poll finds a url, when create answers with none yet', async () => {
    const polledUrl = 'https://sandbox.example/polled'
    const bridge = fakeBridge({
      sandbox: { token: 'sandbox-token', state: ECloudSandboxState.Resuming },
      status: { state: ECloudSandboxState.Running, url: polledUrl },
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
    expect(test.bridge.attached).toEqual([
      { threadId: CLOUD_THREAD, url: polledUrl, token: 'sandbox-token' },
    ])
  })

  it('sends the git identity and the uncommitted patch with the sandbox request', async () => {
    const dirty = { ...CLEAN_WORKSPACE, patch: 'diff --git a/x b/x\n' }
    const test = harness({ capture: async () => dirty })

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: dirty }])
  })

  it("carries the operator's skills bundle to the sandbox request", async () => {
    const test = harness({ skillsBundle: 'bundle-json' })

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE, skillsBundle: 'bundle-json' },
    ])
  })

  it('tells the agent it moved, naming what the move closed', async () => {
    const test = harness()

    await liftToCloud(test.args)

    const notice = test.bridge.log
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the cloud log')
    }

    expect(notice.key).toBe(CLOUD_NOTICE_KEY)
    expect(notice.content).toContain('cloud sandbox')
    expect(notice.content).toContain('bun run dev')
    expect(notice.content).toContain('api')
  })

  it('opens the remote thread for a conversation nobody has spoken in, so the sandbox can attach', async () => {
    const test = harness({ started: false, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
    expect(await test.bridge.threads.find({ threadId: CLOUD_THREAD })).toBeDefined()
    expect(test.localThreads.chosenLocations).toEqual([])
  })
})

const threadOf = (store: FakeThreadStore, threadId: ThreadId) => store.find({ threadId })

describe('lifting a thread the cloud already knows', () => {
  it('marks it as cloud rather than transferring it twice', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'already there' }],
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['flip', 'sandbox', 'attach'])
    expect(await threadOf(bridge.threads, CLOUD_THREAD)).toBeDefined()
  })
})

describe('the workspace a lift carries', () => {
  it('reads a 413 as the patch being too large, keeping the advice the API gave', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 413,
        message:
          'The Atlas Cloud API answered POST /v1/sandboxes with 413: the uncommitted patch is 7.2 MiB, over the 5 MiB ceiling — commit or discard some work before lifting.',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.fault).toBe(ELiftFault.PatchTooLarge)
    expect(lifted.detail).toContain('commit or discard some work')
  })

  it('sends no workspace when there is no repository behind the session', async () => {
    const test = harness({ capture: async () => null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: null }])
  })

  it('says so in the transition notice when no repository came with it', async () => {
    const test = harness({ capture: async () => null })

    await liftToCloud(test.args)

    const notice = test.bridge.log
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the cloud log')
    }

    expect(notice.content).toContain('no git repository')
  })
})
