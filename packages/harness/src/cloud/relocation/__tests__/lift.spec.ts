import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { CloudError, EShellStatus, type GpgKeyMaterial } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { fakeEventLog } from './fake-backend'
import { ELiftStep, liftToCloud } from '../lift'
import { CLOUD_NOTICE_KEY } from '../transition-notice'
import { CLEAN_WORKSPACE, CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

const seedLocalTranscript = async (
  test: ReturnType<typeof harness>,
  texts: readonly string[] = ['take the linter to zero', 'and then ship it'],
): Promise<void> => {
  await test.localThreads.createWithFirstEvents({
    threadId: CLOUD_THREAD,
    runId: toRunId('run_local_seed'),
    drafts: texts.map((text) => ({ type: 'user-said' as const, text })),
    workspace: '/work',
  })
}

describe('lifting a conversation into the cloud', () => {
  it('stops what is running here, tars the session, uploads it after create, and only then attaches', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['sandbox', 'put-transcript', 'attach'])
    expect(test.bridge.transcriptPuts).toHaveLength(1)
    expect(test.steps).toEqual([
      ELiftStep.Stopping,
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELiftStep.Capturing,
      ELiftStep.Starting,
      ELiftStep.UploadingContext,
      ELiftStep.Starting,
      ELiftStep.Attaching,
    ])
  })

  it('carries the whole local transcript across in the session archive', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.transcriptPuts).toHaveLength(1)
    const archive = test.bridge.transcriptPuts[0]?.archive
    expect(archive).toBeDefined()
    expect(archive?.length).toBeGreaterThan(0)
    expect(archive?.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
  })

  it('uploads no transcript for a conversation nobody has spoken in, and still attaches', async () => {
    useAtlasHome()
    const test = harness({ started: false, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.transcriptPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['sandbox', 'attach'])
    expect(test.localThreads.chosenLocations).toEqual([])
  })

  it('records the thread as a cloud thread on the local side', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.located).toEqual([EExecutionLocation.Cloud])
    expect(test.localThreads.chosenLocations).toEqual([
      { threadId: CLOUD_THREAD, location: EExecutionLocation.Cloud },
    ])
  })

  it('attaches to the sandbox the provision handed back', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.bridge.attached).toEqual([
      { threadId: CLOUD_THREAD, url: lifted.sandbox.url, token: lifted.sandbox.token },
    ])
  })

  it('sends the git identity and the uncommitted patch with the sandbox request', async () => {
    useAtlasHome()
    const dirty = { ...CLEAN_WORKSPACE, patch: 'diff --git a/x b/x\n' }
    const test = harness({ capture: async () => dirty })
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: dirty }])
  })

  it("carries the operator's gpg material to the sandbox request, stringified", async () => {
    useAtlasHome()
    const material: GpgKeyMaterial = {
      keyId: 'DEADBEEF1234',
      publicKey: 'PUBLIC BLOCK',
      secretKey: 'SECRET BLOCK',
      ownerTrust: 'TRUST',
      sign: true,
    }
    const test = harness({ captureGpg: async () => material })
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE, gpgKey: JSON.stringify(material) },
    ])
  })

  it('sends no gpg key when the operator has no signing material', async () => {
    useAtlasHome()
    const test = harness({ captureGpg: async () => null })
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE }])
  })

  it("carries the operator's context archive onto the row before the sandbox boots, so serve finds it on the first poll", async () => {
    useAtlasHome()
    const archive = Buffer.from('a fake tar.gz')
    const test = harness({ captureContext: async () => archive })
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE }])
    expect(test.bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
    expect(test.bridge.trail).toEqual(['put-context', 'sandbox', 'put-transcript', 'attach'])
  })

  it('sends no context archive request when there is nothing to carry', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.bridge.contextPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['sandbox', 'put-transcript', 'attach'])
  })

  it('tells the agent it moved, naming what the move closed — in the local log, after the archive shipped', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    const notice = test.localLog
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the local log')
    }

    expect(notice.key).toBe(CLOUD_NOTICE_KEY)
    expect(notice.content).toContain('cloud sandbox')
    expect(notice.content).toContain('bun run dev')
    expect(notice.content).toContain('api')
    expect(
      test.bridge.log.peek({ threadId: CLOUD_THREAD }).some((event) => event.type === 'context-loaded'),
    ).toBe(false)
  })

  it('delivers the endings the move drained into the local log, ahead of the location marker', async () => {
    useAtlasHome()
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
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    const events = test.localLog.peek({ threadId: CLOUD_THREAD })
    const ending = events.find((event) => event.type === 'background-shell-ended')
    if (ending === undefined || ending.type !== 'background-shell-ended') {
      throw new Error('expected the drained shell ending in the local log')
    }
    expect(ending.output).toBe('listening on :3000')

    const marker = events.findIndex((event) => event.type === 'location-changed')
    expect(events.indexOf(ending)).toBeLessThan(marker)
    expect(
      test.bridge.log
        .peek({ threadId: CLOUD_THREAD })
        .some((event) => event.type === 'background-shell-ended'),
    ).toBe(false)
  })

  it('never drains the local notices when the lift fails, so the host conversation still hears them', async () => {
    useAtlasHome()
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
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    if (lifted.ok) throw new Error('expected the lift to fail')
    expect(drains).toBe(0)
  })

  it('marks the location change in the local log, before the transition notice', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    const events = test.localLog.peek({ threadId: CLOUD_THREAD })
    const marker = events.find((event) => event.type === 'location-changed')
    if (marker === undefined || marker.type !== 'location-changed') {
      throw new Error('expected a location-changed event in the local log')
    }
    expect(marker.from).toBe(EExecutionLocation.Host)
    expect(marker.to).toBe(EExecutionLocation.Cloud)
    expect(marker.cwd).toBe('/workspace')
    expect(marker.remoteUrl).toBe('git@github.com:comp-ai/atlas.git')
    expect(marker.branch).toBe('dennis/container-cloud')

    const noticeIndex = events.findIndex((event) => event.type === 'context-loaded')
    expect(events.indexOf(marker)).toBeLessThan(noticeIndex)
  })

  it('keeps the footer selection out of the transcript — the model rides the open, not the archive', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(await test.bridge.threads.find({ threadId: CLOUD_THREAD })).toBeUndefined()
  })
})
