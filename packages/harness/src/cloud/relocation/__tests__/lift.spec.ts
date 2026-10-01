import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { CloudError, EShellStatus } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { ELiftStep, liftToCloud } from '../lift'
import { CLOUD_NOTICE_KEY } from '../transition-notice'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'
import { seedLocalTranscript } from './lift-seed'

describe('lifting a conversation into the cloud', () => {
  it('stops what is running here and stages the transcript before serve boots', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['put-transcript', 'sandbox', 'confirm-landed', 'attach'])
    expect(test.bridge.transcriptPuts).toHaveLength(1)
    expect(test.steps).toEqual([
      ELiftStep.Stopping,
      ELiftStep.Capturing,
      ELiftStep.Transferring,
      ELiftStep.Starting,
      ELiftStep.UploadingContext,
      ELiftStep.Starting,
      ELiftStep.Attaching,
      ELiftStep.Flipping,
    ])
  })

  it('records the thread as a cloud thread on the local side', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect((await test.localThreads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
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
      test.bridge.log
        .peek({ threadId: CLOUD_THREAD })
        .some((event) => event.type === 'context-loaded'),
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

    const cloud = test.bridge.log.peek({ threadId: CLOUD_THREAD })
    const marker = cloud.findIndex((event) => event.type === 'location-changed')
    expect(marker).toBeGreaterThan(-1)
    expect(
      cloud.some((event) => event.type === 'background-shell-ended'),
    ).toBe(false)
  })

  it('never drains the local notices when the lift fails, so the host conversation still hears them', async () => {
    useAtlasHome()
    let drains = 0
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity' }),
    })
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

  it('pins the location change on the sandbox log during restore, not the local one', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    const local = test.localLog.peek({ threadId: CLOUD_THREAD })
    expect(local.some((event) => event.type === 'location-changed')).toBe(false)

    const cloud = test.bridge.log.peek({ threadId: CLOUD_THREAD })
    const marker = cloud.find((event) => event.type === 'location-changed')
    if (marker === undefined || marker.type !== 'location-changed') {
      throw new Error('expected a location-changed event pinned on the sandbox log')
    }
    expect(marker.from).toBe(EExecutionLocation.Host)
    expect(marker.to).toBe(EExecutionLocation.Cloud)
    expect(marker.cwd).toBe('/workspace')
    expect(marker.remoteUrl).toBe('git@github.com:comp-ai/atlas.git')
    expect(marker.branch).toBe('dennis/container-cloud')
  })

  it('waits for pause and archive before provisioning serve', async () => {
    useAtlasHome()
    let createStarted = false
    let pauseSettled = false
    let releasePause = (): void => undefined
    let acknowledgePause = (): void => undefined
    const pausing = new Promise<void>((resolve) => {
      acknowledgePause = resolve
    })
    const bridge = fakeBridge()
    const originalCreate = bridge.sandboxes.create
    bridge.sandboxes.create = async (createArgs) => {
      createStarted = true
      return originalCreate(createArgs)
    }
    const test = harness({
      bridge,
      stopLocal: () => {
        acknowledgePause()
        return new Promise((resolve) => {
          releasePause = () => {
            pauseSettled = true
            resolve({ shells: [], services: [], drainNotices: () => [] })
          }
        })
      },
    })
    await seedLocalTranscript(test)

    const lifting = liftToCloud(test.args)
    await pausing

    expect(pauseSettled).toBe(false)
    expect(createStarted).toBe(false)

    releasePause()
    const lifted = await lifting
    expect(lifted.ok).toBe(true)
    expect(createStarted).toBe(true)
  })

  it('keeps the footer selection out of the transcript — the model rides the open, not the archive', async () => {
    useAtlasHome()
    const test = harness()
    await seedLocalTranscript(test)

    await liftToCloud(test.args)

    expect(await test.bridge.threads.find({ threadId: CLOUD_THREAD })).toBeUndefined()
  })
})
