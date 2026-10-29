import { EBootStep, EBootStepState, EPodResizeApplies, EPodState } from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { SANDBOX_BUSY_MESSAGE } from './sandbox-provisioning-rows'
import { fakeDispatcher, podLaunchWith } from './sandbox-provisioning.fixture'
import { RESIZE_UNMANAGED_MESSAGE } from './thread-pod.service'
import { podServiceOver, realEndpoints, SERVE_URL } from './thread-pod.fixture'

const scope = { userId: 'usr-1', threadId: 'thr-1' }

const calls: string[] = []

const fakeVercel = () => {
  calls.length = 0
  const record = (name: string) =>
    vi.fn(async () => {
      calls.push(name)
    })
  return {
    updateResources: record('update'),
    notifyParked: record('notify'),
    stop: record('stop'),
    inspect: vi.fn(),
    readResources: vi.fn(async () => ({ vcpus: 4, memoryMb: 8192 })),
  }
}

const arrange = (args: { failDispatch?: boolean } = {}) => {
  const vercel = fakeVercel()
  const launched = podLaunchWith({
    dispatcher: fakeDispatcher(args.failDispatch ? { failWith: new Error('queue down') } : {}),
  })
  const service = podServiceOver(
    realEndpoints(),
    vercel as unknown as VercelSandboxClient,
    launched.pod,
  )
  return { vercel, dispatch: launched.dispatch, service }
}

const seedProvisioned = async (partial: Partial<Row<'CloudSandbox'>>) => {
  await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', ...partial })
  await recordBootSteps({
    threadId: 'thr-1',
    steps: [
      { step: EBootStep.Provision, state: EBootStepState.Running },
      { step: EBootStep.Agent, state: EBootStepState.Done },
    ],
  })
}

describe('ThreadPodService resize', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  it('saves the size, stops the sandbox and wakes it as a new boot attempt', async () => {
    await seedProvisioned({ state: 'running', serveUrl: SERVE_URL })
    const { service, vercel, dispatch } = arrange()

    const reply = await service.resize({ ...scope, vcpus: 4 })

    expect(reply).toEqual({ vcpus: 4, appliesAt: EPodResizeApplies.Live })
    expect(calls).toEqual(['update', 'notify', 'stop'])
    expect(vercel.updateResources).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-thr-1',
      vcpus: 4,
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    const pod = await service.status(scope)
    expect(pod.state).toBe(EPodState.Booting)
    expect(pod.steps.map(({ step, state }) => [step, state])).toEqual([
      [EBootStep.Provision, EBootStepState.Running],
    ])
    expect(pod.history).toHaveLength(3)
  })

  it('only saves the size of a parked sandbox, which takes it at the next wake', async () => {
    await seedProvisioned({ state: 'parked', wakeClaim: null })
    const { service, dispatch } = arrange()

    const reply = await service.resize({ ...scope, vcpus: 8 })

    expect(reply.vcpus).toBe(8)
    expect(calls).toEqual(['update'])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses while the sandbox is booting', async () => {
    await seedProvisioned({ state: 'resuming', wakeClaim: new Date() })
    const { service, vercel } = arrange()

    await expect(service.resize({ ...scope, vcpus: 4 })).rejects.toMatchObject({
      status: 409,
      message: SANDBOX_BUSY_MESSAGE,
    })
    expect(vercel.updateResources).not.toHaveBeenCalled()
  })

  it('refuses a sandbox the terminal started', async () => {
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', serveUrl: SERVE_URL })
    const { service, vercel } = arrange()

    await expect(service.resize({ ...scope, vcpus: 4 })).rejects.toMatchObject({
      status: 409,
      message: RESIZE_UNMANAGED_MESSAGE,
    })
    expect(vercel.updateResources).not.toHaveBeenCalled()
  })

  it('answers 502 and fails the claim when the wake cannot be dispatched', async () => {
    await seedProvisioned({ state: 'running', serveUrl: SERVE_URL })
    const { service } = arrange({ failDispatch: true })

    await expect(service.resize({ ...scope, vcpus: 4 })).rejects.toMatchObject({ status: 502 })

    const row = await db.orm.public.CloudSandbox.first({ sessionId: 'ses_thr-1' })
    expect(row?.wakeFailedAt).not.toBeNull()
  })
})
