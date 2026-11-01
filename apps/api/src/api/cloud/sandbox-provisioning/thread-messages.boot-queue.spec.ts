import { EBootStep, EBootStepState, EThreadMessageState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import {
  eventsOf,
  messagesWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'
import { LOCAL_POD_MESSAGE, NOT_RUNNING_MESSAGE } from './sandbox-provisioning-rows'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const

type Step = [EBootStep, EBootStepState]

const SERVE_UP_CLONING: Step[] = [
  [EBootStep.Provision, EBootStepState.Running],
  [EBootStep.Provision, EBootStepState.Done],
  [EBootStep.Serve, EBootStepState.Running],
  [EBootStep.Serve, EBootStepState.Done],
  [EBootStep.Clone, EBootStepState.Running],
]

const AGENT_STARTED: Step[] = [
  ...SERVE_UP_CLONING,
  [EBootStep.Clone, EBootStepState.Done],
  [EBootStep.Agent, EBootStepState.Running],
]

async function seedSteps(steps: readonly Step[]): Promise<void> {
  const start = Date.now() - 60_000
  for (const [index, [step, state]] of steps.entries()) {
    await db.orm.public.SandboxBootStep.create({
      sessionId: 'ses_thr-1',
      step,
      state,
      at: new Date(start + index * 1_000),
    })
  }
}

async function seedBooting(steps: readonly Step[]): Promise<void> {
  await seedSandboxRow()
  await seedSteps(steps)
}

describe('ThreadMessagesService.send while the pod boots and the agent has not started', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('queues the message as an Event without dispatching', async () => {
    await seedBooting(SERVE_UP_CLONING)
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(dispatch).not.toHaveBeenCalled()
    const events = await eventsOf()
    expect(events.map((event) => [event.type, JSON.parse(event.body).requestId])).toEqual([
      ['user-said', 'snd-1'],
    ])
  })

  it('stores the images on the queued user-said event', async () => {
    await seedBooting(SERVE_UP_CLONING)
    const { service } = messagesWith()
    const images = [{ path: 'shot.png', mediaType: 'image/png', data: 'aGk=' }]

    await service.send({ ...ARGS, images })

    const [event] = await eventsOf()
    expect(JSON.parse(event?.body ?? '').images).toEqual(images)
  })

  it('appends a retried sendId once', async () => {
    await seedBooting(SERVE_UP_CLONING)
    const { service } = messagesWith()

    await service.send(ARGS)
    await service.send(ARGS)

    expect(await eventsOf()).toHaveLength(1)
  })

  it('leaves the active claim untouched', async () => {
    await seedBooting(SERVE_UP_CLONING)
    const before = (await sandboxRows())[0]
    const { service } = messagesWith()

    await service.send(ARGS)

    expect((await sandboxRows())[0]?.wakeClaim?.getTime()).toBe(before?.wakeClaim?.getTime())
  })

  it('queues when only an earlier boot attempt started the agent', async () => {
    await seedBooting([
      ...AGENT_STARTED,
      [EBootStep.Agent, EBootStepState.Done],
      ...SERVE_UP_CLONING,
    ])
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(dispatch).not.toHaveBeenCalled()
    expect(await eventsOf()).toHaveLength(1)
  })
})

describe('ThreadMessagesService.takeBack of a message queued while the agent boots', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  const target = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1' } as const

  it('takes the message back before the agent starts', async () => {
    await seedBooting(SERVE_UP_CLONING)
    const { service } = messagesWith()
    await service.send(ARGS)

    await service.takeBack(target)

    expect(await eventsOf()).toHaveLength(0)
  })

  it('refuses with 409 once the agent has started', async () => {
    await seedBooting(SERVE_UP_CLONING)
    const { service } = messagesWith()
    await service.send(ARGS)
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Agent, state: EBootStepState.Running }],
    })

    await expect(service.takeBack(target)).rejects.toMatchObject({ status: 409 })
    expect(await eventsOf()).toHaveLength(1)
  })
})

describe('ThreadMessagesService.send once the agent has started', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it.each([EBootStepState.Running, EBootStepState.Done])(
    'still queues, without dispatching, while the claim holds and the agent step is %s',
    async (agent) => {
      await seedBooting([...SERVE_UP_CLONING, [EBootStep.Agent, agent]])
      const { service, dispatch } = messagesWith()

      expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

      expect(dispatch).not.toHaveBeenCalled()
      expect(await eventsOf()).toHaveLength(1)
    },
  )

  it('refuses a web send to a thread leased to a local pod', async () => {
    await db.orm.public.LocalPodLease.create({
      userId: 'usr-1',
      threadId: 'thr-1',
      tokenHash: 'pod-hash',
    })
    const { service, dispatch } = messagesWith()

    await expect(service.send(ARGS)).rejects.toMatchObject({
      status: 409,
      message: LOCAL_POD_MESSAGE,
    })

    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('refuses a TUI-provisioned running row with no boot steps, appending nothing', async () => {
    await seedSandboxRow({ state: 'running', serveUrl: 'https://serve.example.test' })
    const { service, dispatch } = messagesWith()

    await expect(service.send(ARGS)).rejects.toMatchObject({
      status: 409,
      message: NOT_RUNNING_MESSAGE,
    })

    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
