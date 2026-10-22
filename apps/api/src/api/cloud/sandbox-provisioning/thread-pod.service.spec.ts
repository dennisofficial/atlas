import { EBootStep, EBootStepState, EPodState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { podLaunchWith } from './sandbox-provisioning.fixture'
import { podServiceOver, realEndpoints } from './thread-pod.fixture'

const { Provision, Serve, Clone, Agent } = EBootStep
const { Running, Done, Error: Failed } = EBootStepState

const record = (...steps: [EBootStep, EBootStepState, string?][]) =>
  recordBootSteps({
    threadId: 'thr-1',
    steps: steps.map(([step, state, error]) => ({
      step,
      state,
      ...(error === undefined ? {} : { error }),
    })),
  })

const status = () => podServiceOver(realEndpoints()).status({ userId: 'usr-1', threadId: 'thr-1' })
const shape = async () => {
  const pod = await status()
  return { state: pod.state, steps: pod.steps.map(({ step, state }) => [step, state]) }
}

describe('ThreadPodService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  it('answers none with no steps for a thread that never had a pod', async () => {
    expect(await shape()).toEqual({ state: EPodState.None, steps: [] })
  })

  it('answers running for a serving sandbox', async () => {
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'running',
      serveUrl: 'https://serve.example.test',
    })
    await record([Provision, Running], [Provision, Done], [Agent, Done])

    expect((await shape()).state).toBe(EPodState.Running)
  })

  it('answers booting for a live wake claim, even when an earlier attempt errored', async () => {
    await record([Provision, Running], [Provision, Failed, 'old failure'], [Provision, Running])
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'resuming',
      wakeClaim: new Date(),
    })

    expect(await shape()).toEqual({
      state: EPodState.Booting,
      steps: [[Provision, Running]],
    })
  })

  it('answers failed when the latest recorded step is an error', async () => {
    await record([Provision, Running], [Provision, Done], [Clone, Running], [Clone, Failed, 'x'])
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', state: 'resuming' })

    const pod = await status()

    expect(pod.state).toBe(EPodState.Failed)
    expect(pod.steps.at(-1)).toMatchObject({ step: Clone, state: Failed, error: 'x' })
  })

  it('answers failed when the row failed after its claim, with no error step recorded', async () => {
    const claimed = new Date(Date.now() - 5_000)
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'resuming',
      wakeClaim: claimed,
      wakeFailedAt: new Date(),
    })

    expect((await status()).state).toBe(EPodState.Failed)
  })

  it('answers failed when markFailed cleared the claim', async () => {
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'resuming',
      wakeClaim: null,
      wakeFailedAt: new Date(),
    })

    expect((await status()).state).toBe(EPodState.Failed)
  })

  it('answers failed for a not-configured attempt that has only a Provision/Error row', async () => {
    await record([Provision, Failed, 'no credential'])

    expect(await shape()).toEqual({ state: EPodState.Failed, steps: [[Provision, Failed]] })
  })

  it('answers parked for a parked row whose last step is not an error', async () => {
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', state: 'parked' })
    await record([Provision, Running], [Provision, Done], [Agent, Done])

    expect((await shape()).state).toBe(EPodState.Parked)
  })

  it('answers failed, not parked, for a parked row whose latest step is an error', async () => {
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', state: 'parked' })
    await record([Provision, Running], [Provision, Failed, 'x'])

    expect((await shape()).state).toBe(EPodState.Failed)
  })

  it('returns only the steps from the last Provision/Running onward', async () => {
    await record(
      [Provision, Running],
      [Provision, Done],
      [Serve, Running],
      [Serve, Failed, 'first attempt'],
      [Provision, Running],
      [Provision, Done],
      [Serve, Running],
    )
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'resuming',
      wakeClaim: new Date(),
    })

    expect((await shape()).steps).toEqual([
      [Provision, Running],
      [Provision, Done],
      [Serve, Running],
    ])
  })

  it('shows only the new attempt right after a re-claim of a failed pod', async () => {
    await record([Provision, Running], [Provision, Failed, 'old failure'])
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'resuming',
      wakeClaim: null,
      wakeFailedAt: new Date(),
    })
    const existing = await db.orm.public.CloudSandbox.first({ threadId: 'thr-1' })
    const thread = await db.orm.public.Thread.where({ id: 'thr-1' }).all().firstOrThrow()

    const claim = await podLaunchWith().pod.claim({ thread, existing })

    expect(claim).not.toBeNull()
    expect(await shape()).toEqual({ state: EPodState.Booting, steps: [[Provision, Running]] })
  })

  it('falls back to the last Provision step of any state when none is Running', async () => {
    await record([Provision, Done], [Serve, Running], [Provision, Failed, 'x'], [Serve, Running])

    expect((await shape()).steps).toEqual([
      [Provision, Failed],
      [Serve, Running],
    ])
  })

  it('returns every step when no Provision step was recorded', async () => {
    await record([Serve, Running], [Serve, Done])

    expect((await shape()).steps).toEqual([
      [Serve, Running],
      [Serve, Done],
    ])
  })

  it('answers 404 for a thread someone else owns and for one that does not exist', async () => {
    await record([Provision, Failed, 'x'])
    const other = podServiceOver(realEndpoints())

    await expect(other.status({ userId: 'usr-2', threadId: 'thr-1' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(other.status({ userId: 'usr-1', threadId: 'nope' })).rejects.toMatchObject({
      status: 404,
    })
  })
})
