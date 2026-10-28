import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  EBootStep,
  EBootStepState,
  EPodState,
  ERuntimePhase,
  type RuntimeCheckpoint,
  ESandboxProvisionState,
  EThreadStreamFrame,
  EVercelCredentialGap,
} from '@dltech/atlas-wire'

import { PodNotConfiguredError } from '../api-pod-errors'
import { createApiPodBridge } from '../api-pod-bridge'
import { EResizeApplies } from '../cloud-bridge'
import { CloudError } from '../cloud-transport'
import { ECloudSandboxState } from '../sandbox-client'
import {
  cloudFailure,
  createFakePodApi,
  statusOf,
  stepOf,
  type FakePodApi,
} from './api-pod-fixture'
import { createFakeTimerClock } from './fake-timer-clock'

const THREAD = toThreadId('thr_pod')
const running = statusOf(EPodState.Running, [], {
  sandboxId: 'sbx_1',
  region: 'iad1',
  vcpus: 4,
  memoryMb: 8192,
})

const bridgeOf = (fake: FakePodApi) =>
  createApiPodBridge({
    api: fake.api,
    clock: createFakeTimerClock().clock,
    timeoutMs: 60_000,
    pollMs: 1_000,
  })

const checkpointOf = (threadId: string): RuntimeCheckpoint => ({
  threadId,
  runtimeId: 'rt',
  sandboxSessionId: 'ses',
  revision: 1,
  reportedAt: '2026-10-27T10:00:00.000Z',
  transcript: { head: 0, count: 0, digest: '0'.repeat(64) },
  phase: ERuntimePhase.Parked,
})

describe('create', () => {
  it('connects a running pod and returns the fresh ticket as the token', async () => {
    const fake = createFakePodApi({ statuses: [running] })

    const sandbox = await bridgeOf(fake).sandboxes.create({ threadId: THREAD, projectId: null })

    expect(sandbox).toEqual({
      url: 'https://pod.test',
      token: 'ticket-1',
      state: ECloudSandboxState.Running,
      created: false,
    })
    expect(fake.calls).toEqual([`status:${THREAD}`, `connect:${THREAD}`])
  })

  it('provisions a parked pod, waits for it to run, then connects', async () => {
    const fake = createFakePodApi({
      statuses: [statusOf(EPodState.Parked), running],
    })

    await bridgeOf(fake).sandboxes.create({ threadId: THREAD, projectId: 'proj_1' })

    expect(fake.calls).toEqual([
      `status:${THREAD}`,
      `provision:${THREAD}`,
      `status:${THREAD}`,
      `connect:${THREAD}`,
    ])
  })

  it('does not create a thread when the create is not a birth', async () => {
    const fake = createFakePodApi({ statuses: [running] })

    await bridgeOf(fake).sandboxes.create({ threadId: THREAD, projectId: 'proj_1' })

    expect(fake.calls.some((call) => call.startsWith('create:'))).toBe(false)
  })

  it('creates the thread under its id first on a birth, with no first message', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.None), running] })

    await bridgeOf(fake).sandboxes.create({
      threadId: THREAD,
      projectId: 'proj_1',
      model: 'anthropic/claude',
      birth: { effort: 'high' },
    })

    expect(fake.calls[0]).toBe(
      `create:${JSON.stringify({ id: THREAD, projectId: 'proj_1', model: 'anthropic/claude', effort: 'high' })}`,
    )
    expect(fake.calls[1]).toBe(`status:${THREAD}`)
    expect(fake.calls).toContain(`provision:${THREAD}`)
  })

  it('omits the project and model the birth does not name', async () => {
    const fake = createFakePodApi({ statuses: [running] })

    await bridgeOf(fake).sandboxes.create({
      threadId: THREAD,
      projectId: null,
      birth: { effort: 'low' },
    })

    expect(fake.calls[0]).toBe(`create:${JSON.stringify({ id: THREAD, effort: 'low' })}`)
  })

  it('treats a 409 on the birth create as an earlier attempt having made the thread', async () => {
    const fake = createFakePodApi({ statuses: [running] })
    fake.failCreateWith(cloudFailure(409))

    const sandbox = await bridgeOf(fake).sandboxes.create({
      threadId: THREAD,
      projectId: null,
      birth: { effort: 'low' },
    })

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
  })

  it('fails the birth on any other create failure', async () => {
    const fake = createFakePodApi({ statuses: [running] })
    fake.failCreateWith(cloudFailure(403))

    const failure = await bridgeOf(fake)
      .sandboxes.create({ threadId: THREAD, projectId: null, birth: { effort: 'low' } })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect(failure).toMatchObject({ status: 403 })
    expect(fake.calls).toHaveLength(1)
  })

  it('fails with the gap and message when provision answers not-configured', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.None)] })
    fake.setProvision({
      state: ESandboxProvisionState.NotConfigured,
      error: 'No Vercel credentials.',
      gap: EVercelCredentialGap.WorkspaceCredential,
    })

    const failure = await bridgeOf(fake)
      .sandboxes.create({ threadId: THREAD, projectId: null })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PodNotConfiguredError)
    expect(failure).toMatchObject({ gap: EVercelCredentialGap.WorkspaceCredential })
    expect(String(failure)).toContain('No Vercel credentials.')
    expect(fake.calls.some((call) => call.startsWith('connect:'))).toBe(false)
  })

  it('narrates boot steps with the thread they belong to', async () => {
    const fake = createFakePodApi({
      statuses: [
        statusOf(EPodState.None),
        statusOf(EPodState.Booting, [stepOf(EBootStep.Clone, EBootStepState.Running)]),
        running,
      ],
    })
    const seen: Array<{ threadId: string; label: string }> = []
    const bridge = createApiPodBridge({
      api: fake.api,
      clock: createFakeTimerClock().clock,
      onBootStep: (step) => seen.push(step),
    })

    const created = bridge.sandboxes.create({ threadId: THREAD, projectId: null })
    await Bun.sleep(10)
    fake.streams[0]?.onData?.({ type: EThreadStreamFrame.Pod })
    await Bun.sleep(10)
    fake.streams[0]?.onData?.({ type: EThreadStreamFrame.Pod })
    await created

    expect(seen).toEqual([{ threadId: THREAD, label: 'cloning the project' }])
  })

  it('mints a new ticket on every create', async () => {
    const fake = createFakePodApi({ statuses: [running] })
    const bridge = bridgeOf(fake)

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })
    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(fake.tickets).toEqual(['ticket-1', 'ticket-2'])
  })
})

describe('find', () => {
  it.each([
    [EPodState.Running, ECloudSandboxState.Running],
    [EPodState.Parked, ECloudSandboxState.Parked],
    [EPodState.Booting, ECloudSandboxState.Resuming],
    [EPodState.Failed, ECloudSandboxState.Stopped],
    [EPodState.None, ECloudSandboxState.Stopped],
  ])('maps the %s pod to %s', async (pod, sandbox) => {
    const fake = createFakePodApi({ statuses: [statusOf(pod)] })

    const found = await bridgeOf(fake).sandboxes.find({ threadId: THREAD })

    expect(found?.state).toBe(sandbox)
  })

  it('carries the stored checkpoint so a parked thread skips the eager wake', async () => {
    const checkpoint = checkpointOf(THREAD)
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.Parked)], checkpoint })

    const found = await bridgeOf(fake).sandboxes.find({ threadId: THREAD })

    expect(found).toEqual({ state: ECloudSandboxState.Parked, checkpoint })
  })

  it('drops a checkpoint that names another thread', async () => {
    const fake = createFakePodApi({
      statuses: [statusOf(EPodState.Parked)],
      checkpoint: checkpointOf('thr_other'),
    })

    const found = await bridgeOf(fake).sandboxes.find({ threadId: THREAD })

    expect(found?.checkpoint).toBeNull()
  })
})

describe('resources and lifecycle', () => {
  it('reads vcpus and memory from the status resources', async () => {
    const fake = createFakePodApi({ statuses: [running] })

    expect(await bridgeOf(fake).sandboxes.readResources({ threadId: THREAD })).toEqual({
      vcpus: 4,
      memoryMb: 8192,
    })
  })

  it('reads nothing when the pod has no resources', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.None)] })

    expect(await bridgeOf(fake).sandboxes.readResources({ threadId: THREAD })).toEqual({})
  })

  it('resizes through the api and reports a live resize', async () => {
    const fake = createFakePodApi({ statuses: [running] })

    const reply = await bridgeOf(fake).sandboxes.updateResources({ threadId: THREAD, vcpus: 6 })

    expect(reply).toEqual({ appliesAt: EResizeApplies.Live })
    expect(fake.calls).toEqual([`resize:${THREAD}:6`])
  })

  it('destroys through the api and ignores the expected sandbox session', async () => {
    const fake = createFakePodApi({ statuses: [running] })

    await bridgeOf(fake).sandboxes.destroy({
      threadId: THREAD,
      expectedSandboxSessionId: 'ses_old',
    })

    expect(fake.calls).toEqual([`destroy:${THREAD}`])
  })
})
