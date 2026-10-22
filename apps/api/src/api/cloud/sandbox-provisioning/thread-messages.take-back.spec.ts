import { EBootStep, EBootStepState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { applyPodEvents } from '../../platform/sandboxes/pod-events'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  appendRaw,
  eventsOf,
  messagesWith,
  seedThread,
  threadRow,
} from './sandbox-provisioning.fixture'
import { TAKE_BACK_TOO_LATE_MESSAGE } from './thread-messages.service'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }
const SAID = (sendId: string, text: string) =>
  JSON.stringify({ type: 'user-said', text, requestId: sendId })

const podAnswer = (seq: number) => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: JSON.stringify({ type: 'assistant-said', parts: [] }),
})

describe('ThreadMessagesService.takeBack', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  const target = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1' } as const

  it('deletes the last user-said event and winds the head back', async () => {
    const { service } = messagesWith()
    await service.send(ARGS)

    await service.takeBack(target)

    expect(await eventsOf()).toHaveLength(0)
    expect((await threadRow())?.head).toBe(0)
  })

  it('lets the next send reuse the freed seq', async () => {
    const { service } = messagesWith()
    await service.send(ARGS)
    await service.takeBack(target)

    await service.send({ ...ARGS, sendId: 'snd-2', text: 'again' })

    expect(
      (await eventsOf()).map((event) => [event.seq, JSON.parse(event.body).requestId]),
    ).toEqual([[1, 'snd-2']])
  })

  it('refuses with 409 when a later core event exists', async () => {
    const { service } = messagesWith()
    await service.send(ARGS)
    await appendRaw({
      type: 'assistant-said',
      body: JSON.stringify({ type: 'assistant-said', parts: [] }),
    })

    await expect(service.takeBack(target)).rejects.toMatchObject({
      status: 409,
      message: TAKE_BACK_TOO_LATE_MESSAGE,
    })
    expect(await eventsOf()).toHaveLength(2)
  })

  it('refuses with 409 when a serve is running for the thread', async () => {
    await appendRaw({ type: 'user-said', body: SAID('snd-1', 'hello') })
    const { service } = messagesWith({ endpoint: ENDPOINT })

    await expect(service.takeBack(target)).rejects.toMatchObject({ status: 409 })
    expect(await eventsOf()).toHaveLength(1)
  })

  it('refuses with 409 once the pod answer reached Postgres', async () => {
    const { service } = messagesWith()
    await service.send(ARGS)
    await applyPodEvents({ threadId: 'thr-1', events: [podAnswer(2)] })

    await expect(service.takeBack(target)).rejects.toMatchObject({
      status: 409,
      message: TAKE_BACK_TOO_LATE_MESSAGE,
    })
    expect(await eventsOf()).toHaveLength(2)
  })

  it('answers 404 when no such message exists', async () => {
    const { service } = messagesWith()

    await expect(service.takeBack(target)).rejects.toMatchObject({ status: 404 })
  })

  it('answers 404 for a message that is not a user-said', async () => {
    await appendRaw({ type: 'assistant-said', body: JSON.stringify({ requestId: 'snd-1' }) })
    const { service } = messagesWith()

    await expect(service.takeBack(target)).rejects.toMatchObject({ status: 404 })
  })

  it("does not take back on another user's thread", async () => {
    const { service } = messagesWith()
    await service.send(ARGS)

    await expect(service.takeBack({ ...target, userId: 'usr-2' })).rejects.toThrow(
      'thread not found',
    )
    expect(await eventsOf()).toHaveLength(1)
  })

  it('refuses when a legacy boot-step row follows, since deleting would leave a seq gap', async () => {
    const { service } = messagesWith()
    await service.send(ARGS)
    await appendRaw({ type: 'sandbox-boot-step', body: '{}' })

    await expect(service.takeBack(target)).rejects.toMatchObject({ status: 409 })
  })

  const recordAttempt = (agent: EBootStepState) =>
    recordBootSteps({
      threadId: 'thr-1',
      steps: [
        { step: EBootStep.Provision, state: EBootStepState.Running },
        { step: EBootStep.Agent, state: agent },
      ],
    })

  it.each([EBootStepState.Running, EBootStepState.Done])(
    'refuses with 409 when the latest attempt has an agent step in state %s',
    async (agent) => {
      const { service } = messagesWith()
      await service.send(ARGS)
      await recordAttempt(agent)

      await expect(service.takeBack(target)).rejects.toMatchObject({
        status: 409,
        message: TAKE_BACK_TOO_LATE_MESSAGE,
      })
      expect(await eventsOf()).toHaveLength(1)
    },
  )

  it('still takes back when the latest attempt failed before the agent started', async () => {
    const { service } = messagesWith()
    await service.send(ARGS)
    await recordAttempt(EBootStepState.Error)

    await service.takeBack(target)

    expect(await eventsOf()).toHaveLength(0)
  })
})
