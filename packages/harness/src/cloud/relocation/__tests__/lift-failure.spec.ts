import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPlacementMovePhase } from '@dltech/atlas-core'
import { CloudError, GitCredentialError, VercelNotConfiguredError } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { ELiftFault, ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('a lift that does not finish', () => {
  it('stays on the host when the sandbox will not start, and never flips', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(test.bridge.attached).toEqual([])
  })

  it('stays put when the context archive will not reach the sandbox', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      putContextFails: new CloudError({ status: 500, message: 'the control plane fell over' }),
    })
    const test = harness({ bridge, captureContext: async () => Buffer.from('a fake tar.gz') })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Context)
    expect(lifted.step).toBe(ELiftStep.UploadingContext)
    expect(lifted.detail).toContain('the control plane fell over')
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(test.bridge.attached).toEqual([])
  })

  it('fails at Starting, still pre-commit, when the transcript will not reach the sandbox', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      putTranscriptFails: new CloudError({ status: 500, message: 'the row would not take the tar' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(lifted.step).toBe(ELiftStep.Starting)
    expect(lifted.detail).toContain('the row would not take the tar')
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(test.bridge.attached).toEqual([])
  })

  it('refuses the flip when the sandbox never confirms the transcript landed', async () => {
    useAtlasHome()
    const bridge = fakeBridge({ confirmLanded: false })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.step).toBe(ELiftStep.Starting)
    expect(lifted.detail).toContain('never confirmed the transcript landed')
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(test.bridge.attached).toEqual([])
  })

  it('reads a 503 from the sandbox routes as the cloud not being set up', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 503, message: 'sandboxes are not configured' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.NotConfigured)
    expect(lifted.detail).toContain('not configured')
  })

  it('reads a missing Vercel token as the cloud sandboxes not being set up, with the teaching intact', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new VercelNotConfiguredError('add your Vercel token'),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.NotConfigured)
    expect(lifted.detail).toContain('add your Vercel token')
    expect(lifted.detail).toContain('cloud sandboxes')
  })

  it('reads a gh failure as git access missing, teaching the login', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new GitCredentialError('run `gh auth login`, then try again'),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.GitAuth)
    expect(lifted.step).toBe(ELiftStep.Starting)
    expect(lifted.detail).toContain('gh auth login')
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
  })

  it('keeps the real message of a 503 that is not the not-configured one', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 503,
        message: 'this deployment has no atlas serve binary at /app/atlas-serve',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(lifted.detail).toContain('no atlas serve binary')
  })

  it('reads an unreachable API as unreachable rather than as a refusal', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 0, message: 'connect ECONNREFUSED' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Unreachable)
  })

  it('keeps the committed cloud placement when the open after attach fails — the conversation moved', async () => {
    useAtlasHome()
    const test = harness({
      open: async () => {
        throw new CloudError({ status: 404, message: 'Cannot GET /v1/threads/x/events/head' })
      },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.step).toBe(ELiftStep.Attaching)
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)
    expect((await test.localThreads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )

    await test.placement.recover({
      threadId: CLOUD_THREAD,
      reconcile: async (record) => record.placement,
    })
    expect(test.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
  })

  it('names what the move already closed when it fails after stopping them', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.stopped).toMatchObject({ shells: ['bun run dev'], services: ['api'] })
  })
})
