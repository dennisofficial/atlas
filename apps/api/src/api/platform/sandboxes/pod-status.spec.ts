import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  EBootStep,
  EBootStepState,
  EPodState,
  EThreadStreamFrame,
  type ThreadStreamFrame,
} from '@dltech/atlas-wire'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { DrainStateService } from '../health/drain-state.service'
import { ThreadSignalsService } from '../sessions/thread-signals.service'
import { readPodStatus } from './pod-status'
import { recordBootSteps } from './sandbox-boot-steps'

describe('published pod lifecycle status', () => {
  useTestDatabase()
  let signals: ThreadSignalsService
  let frames: ThreadStreamFrame[]

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'thr-1', userId: USER_A })
    signals = new ThreadSignalsService(new DrainStateService())
    frames = []
    signals.openStream({ threadId: 'thr-1', onFrame: (frame) => frames.push(frame) })
  })
  afterEach(async () => {
    await signals.changesSettled()
    signals.closeAll()
  })

  const publishedPod = async (threadId = 'thr-1') => {
    await signals.podChanged({ threadId })
    return frames.findLast((frame) => frame.type === EThreadStreamFrame.Pod)
  }

  it('includes current boot steps and history with no live-provider resource read', async () => {
    await seedSandboxRow({ threadId: 'thr-1', state: 'resuming', wakeClaim: new Date() })
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Clone, state: EBootStepState.Running }],
    })
    expect(await publishedPod()).toMatchObject({
      type: EThreadStreamFrame.Pod,
      status: {
        state: EPodState.Booting,
        steps: [{ step: EBootStep.Clone, state: EBootStepState.Running }],
        history: [{ step: EBootStep.Clone }],
      },
    })
    const status = await readPodStatus({ threadId: 'thr-1' })
    expect(status.resources).toBeUndefined()
  })

  it('publishes failed boot status even without a sandbox row', async () => {
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Clone, state: EBootStepState.Error, error: 'clone failed' }],
    })
    expect(await publishedPod()).toMatchObject({
      status: { state: EPodState.Failed, steps: [{ error: 'clone failed' }] },
    })
  })

  it('publishes parked state', async () => {
    await seedSandboxRow({ threadId: 'thr-1', state: 'parked' })
    expect(await publishedPod()).toMatchObject({ status: { state: EPodState.Parked } })
  })

  it('resolves a teammate to the manager pod and boot history', async () => {
    await seedSandboxRow({ threadId: 'thr-1', serveUrl: 'https://serve.example.test' })
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Clone, state: EBootStepState.Done }],
    })
    await seedThreadRow({ id: 'thr-mate', userId: USER_A, managedBySessionId: 'ses_thr-1' })
    const mateFrames: ThreadStreamFrame[] = []
    signals.openStream({ threadId: 'thr-mate', onFrame: (frame) => mateFrames.push(frame) })
    await signals.podChanged({ threadId: 'thr-mate' })
    expect(mateFrames).toContainEqual({
      type: EThreadStreamFrame.Pod,
      status: { ...(await readPodStatus({ threadId: 'thr-1' })), rev: 1 },
      rev: 1,
    })
    expect(mateFrames[0]).toMatchObject({
      status: { state: EPodState.Running, steps: [{ step: EBootStep.Clone }] },
    })
    expect(frames).toEqual([])
    expect((await db.orm.public.Thread.where({ id: 'thr-1' }).all().firstOrThrow()).rev).toBe(0)
  })
})
