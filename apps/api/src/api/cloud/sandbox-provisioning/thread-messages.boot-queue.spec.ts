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

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }

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
      threadId: 'thr-1',
      step,
      state,
      at: new Date(start + index * 1_000),
    })
  }
}

async function seedServeUp(steps: readonly Step[]): Promise<void> {
  await seedSandboxRow({ state: 'running', serveUrl: ENDPOINT.url })
  await seedSteps(steps)
}

describe('ThreadMessagesService.send while serve is up but the agent has not started', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('queues the message as an Event instead of handing it to serve', async () => {
    await seedServeUp(SERVE_UP_CLONING)
    const { service, serve, dispatch } = messagesWith({ endpoint: ENDPOINT })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(serve).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    const events = await eventsOf()
    expect(events.map((event) => [event.type, JSON.parse(event.body).requestId])).toEqual([
      ['user-said', 'snd-1'],
    ])
  })

  it('stores the images on the queued user-said event', async () => {
    await seedServeUp(SERVE_UP_CLONING)
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })
    const images = [{ path: 'shot.png', mediaType: 'image/png', data: 'aGk=' }]

    await service.send({ ...ARGS, images })

    expect(serve).not.toHaveBeenCalled()
    const [event] = await eventsOf()
    expect(JSON.parse(event?.body ?? '').images).toEqual(images)
  })

  it('appends a retried sendId once', async () => {
    await seedServeUp(SERVE_UP_CLONING)
    const { service } = messagesWith({ endpoint: ENDPOINT })

    await service.send(ARGS)
    await service.send(ARGS)

    expect(await eventsOf()).toHaveLength(1)
  })

  it('leaves the running row unclaimed', async () => {
    await seedServeUp(SERVE_UP_CLONING)
    const before = (await sandboxRows())[0]
    const { service } = messagesWith({ endpoint: ENDPOINT })

    await service.send(ARGS)

    expect((await sandboxRows())[0]?.wakeClaim?.getTime()).toBe(before?.wakeClaim?.getTime())
  })

  it('queues when only an earlier boot attempt started the agent', async () => {
    await seedServeUp([
      ...AGENT_STARTED,
      [EBootStep.Agent, EBootStepState.Done],
      ...SERVE_UP_CLONING,
    ])
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(serve).not.toHaveBeenCalled()
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
    await seedServeUp(SERVE_UP_CLONING)
    const { service } = messagesWith({ endpoint: ENDPOINT })
    await service.send(ARGS)

    await service.takeBack(target)

    expect(await eventsOf()).toHaveLength(0)
  })

  it('refuses with 409 once the agent has started', async () => {
    await seedServeUp(SERVE_UP_CLONING)
    const { service } = messagesWith({ endpoint: ENDPOINT })
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
    'delivers live when the latest attempt has an agent step in state %s',
    async (agent) => {
      await seedServeUp([...SERVE_UP_CLONING, [EBootStep.Agent, agent]])
      const { service, serve } = messagesWith({ endpoint: ENDPOINT })

      expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Delivered })

      expect(serve).toHaveBeenCalledTimes(1)
      expect(await eventsOf()).toHaveLength(0)
    },
  )

  it('delivers live to a TUI-provisioned row with no boot steps', async () => {
    await seedSandboxRow({ state: 'running', serveUrl: ENDPOINT.url })
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Delivered })

    expect(serve).toHaveBeenCalledTimes(1)
    expect(await eventsOf()).toHaveLength(0)
  })
})
