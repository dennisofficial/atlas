import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import { CloudError, EShellStatus, type GpgKeyMaterial } from '@dltech/atlas-harness'

import { fakeEventLog, type FakeThreadStore } from '../../__tests__/fake-backend'
import { ECloudSandboxState } from '../cloud-bridge'
import { ELiftFault, ELiftStep, liftToCloud } from '../lift'
import { CLOUD_NOTICE_KEY } from '../transition-notice'
import { CLEAN_WORKSPACE, CLOUD_THREAD, fakeBridge } from './fixture'
import { FOOTER_SELECTION, harness } from './lift-fixture'

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
      ELiftStep.UploadingContext,
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

  it('attaches to the sandbox the provision handed back', async () => {
    const test = harness()

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.bridge.attached).toEqual([
      { threadId: CLOUD_THREAD, url: lifted.sandbox.url, token: lifted.sandbox.token },
    ])
  })

  it('sends the git identity and the uncommitted patch with the sandbox request', async () => {
    const dirty = { ...CLEAN_WORKSPACE, patch: 'diff --git a/x b/x\n' }
    const test = harness({ capture: async () => dirty })

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: dirty }])
  })

  it("carries the operator's gpg material to the sandbox request, stringified", async () => {
    const material: GpgKeyMaterial = {
      keyId: 'DEADBEEF1234',
      publicKey: 'PUBLIC BLOCK',
      secretKey: 'SECRET BLOCK',
      ownerTrust: 'TRUST',
      sign: true,
    }
    const test = harness({ captureGpg: async () => material })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE, gpgKey: JSON.stringify(material) },
    ])
  })

  it('sends no gpg key when the operator has no signing material', async () => {
    const test = harness({ captureGpg: async () => null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE }])
  })

  it("carries the operator's context archive to the sandbox after it is created", async () => {
    const archive = Buffer.from('a fake tar.gz')
    const test = harness({ captureContext: async () => archive })

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE }])
    expect(test.bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'put-context', 'attach'])
  })

  it('sends no context archive request when there is nothing to carry', async () => {
    const test = harness()

    await liftToCloud(test.args)

    expect(test.bridge.contextPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
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

  it('delivers the endings the move drained into the cloud log, ahead of the location marker', async () => {
    const test = harness({
      stopLocal: async () => ({
        shells: ['bun run dev'],
        services: [],
        drainNotices: () => [
          {
            type: 'background-shell-ended',
            shellId: 'bash_1',
            command: 'bun run dev',
            description: 'dev server',
            status: EShellStatus.Killed,
            exitCode: undefined,
            output: 'listening on :3000',
            droppedCharacters: 0,
            remainingCharacters: 0,
          },
        ],
      }),
    })

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    const events = test.bridge.log.peek({ threadId: CLOUD_THREAD })
    const ending = events.find((event) => event.type === 'background-shell-ended')
    if (ending === undefined || ending.type !== 'background-shell-ended') {
      throw new Error('expected the drained shell ending in the cloud log')
    }
    expect(ending.output).toBe('listening on :3000')

    const marker = events.findIndex((event) => event.type === 'location-changed')
    expect(events.indexOf(ending)).toBeLessThan(marker)
  })

  it('never drains the local notices when the lift fails, so the host conversation still hears them', async () => {
    let drains = 0
    const bridge = fakeBridge({ createFails: new CloudError({ status: 500, message: 'no capacity' }) })
    const test = harness({
      bridge,
      stopLocal: async () => ({
        shells: ['bun run dev'],
        services: [],
        drainNotices: () => {
          drains += 1
          return []
        },
      }),
    })

    const lifted = await liftToCloud(test.args)

    if (lifted.ok) throw new Error('expected the lift to fail')
    expect(drains).toBe(0)
  })

  it('marks the location change in the cloud log, before the transition notice', async () => {
    const test = harness()

    await liftToCloud(test.args)

    const events = test.bridge.log.peek({ threadId: CLOUD_THREAD })
    const marker = events.find((event) => event.type === 'location-changed')
    if (marker === undefined || marker.type !== 'location-changed') {
      throw new Error('expected a location-changed event in the cloud log')
    }
    expect(marker.from).toBe(EExecutionLocation.Host)
    expect(marker.to).toBe(EExecutionLocation.Cloud)
    expect(marker.cwd).toBe('/workspace')
    expect(marker.remoteUrl).toBe('git@github.com:comp-ai/atlas.git')
    expect(marker.branch).toBe('dennis/container-cloud')

    const noticeIndex = events.findIndex((event) => event.type === 'context-loaded')
    expect(events.indexOf(marker)).toBeLessThan(noticeIndex)
  })

  it('carries the footer selection to the cloud store, so serve picks it up', async () => {
    const test = harness()

    await liftToCloud(test.args)

    const cloud = await test.bridge.threads.find({ threadId: CLOUD_THREAD })
    expect(cloud?.model).toEqual(FOOTER_SELECTION)
  })

  it('carries the selection even when the thread never persisted a model locally', async () => {
    const test = harness({ started: false, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    const cloud = await test.bridge.threads.find({ threadId: CLOUD_THREAD })
    expect(cloud?.model).toEqual(FOOTER_SELECTION)
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
  it('replaces the cloud log with the local one, then flips', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'stale cloud copy' }],
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['flip', 'sandbox', 'attach'])
    expect(
      bridge.log
        .peek({ threadId: CLOUD_THREAD })
        .filter((event) => event.type === 'user-said')
        .map((event) => event.text),
    ).toEqual(['take the linter to zero', 'and then ship it'])
  })

  it('refuses to wipe a cloud log when the local log is empty', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'only ever in the cloud' }],
    })
    const test = harness({ bridge, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    if (lifted.ok) throw new Error('expected the lift to fail')
    expect(lifted.detail).toContain('refusing to wipe')
    expect(
      bridge.log
        .peek({ threadId: CLOUD_THREAD })
        .filter((event) => event.type === 'user-said')
        .map((event) => event.text),
    ).toEqual(['only ever in the cloud'])
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

describe('gating the context archive on whether the sandbox already has it', () => {
  it('skips capturing and uploading when the sandbox resumed from its snapshot', async () => {
    let captureCalls = 0
    const bridge = fakeBridge({
      sandbox: {
        url: 'https://sandbox.example/resumed',
        token: 'sandbox-token',
        state: ECloudSandboxState.Running,
        created: false,
      },
    })
    const test = harness({
      bridge,
      captureContext: async () => {
        captureCalls += 1
        return Buffer.from('a fake tar.gz')
      },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(captureCalls).toBe(0)
    expect(test.bridge.contextPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
  })

  it('captures and uploads when the sandbox was created fresh', async () => {
    const archive = Buffer.from('a fake tar.gz')
    const test = harness({ captureContext: async () => archive })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
  })
})
