import { EBootStep, EBootStepState, EThreadMessageState } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import {
  appendRaw,
  bootSteps,
  eventsOf,
  fakeDispatcher,
  fakeScoped,
  messagesWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
  threadRow,
} from './sandbox-provisioning.fixture'
import { TAKE_BACK_TOO_LATE_MESSAGE } from './thread-messages.service'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }
const SAID = (sendId: string, text: string) =>
  JSON.stringify({ type: 'user-said', text, requestId: sendId })

describe('ThreadMessagesService.send', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('delivers live when the sandbox is running, appending nothing', async () => {
    const { service, serve, dispatch } = messagesWith({ endpoint: ENDPOINT })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Delivered })
    expect(serve).toHaveBeenCalledWith({
      ...ENDPOINT,
      threadId: 'thr-1',
      sendId: 'snd-1',
      text: 'hello',
    })
    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers 502 when delivery to a running sandbox fails', async () => {
    const { service } = messagesWith({ endpoint: ENDPOINT, serveFails: new Error('socket down') })

    await expect(service.send(ARGS)).rejects.toMatchObject({ status: 502 })
  })

  it("does not send to another user's thread", async () => {
    const { service, serve } = messagesWith({ endpoint: ENDPOINT })

    await expect(service.send({ ...ARGS, userId: 'usr-2' })).rejects.toThrow('thread not found')
    expect(serve).not.toHaveBeenCalled()
  })

  it('appends a user-said event, claims and dispatches when nothing runs', async () => {
    const { service, serve, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    const [event] = await eventsOf()
    expect(event).toMatchObject({ seq: 1, type: 'user-said' })
    expect(JSON.parse(event?.body ?? '')).toEqual({
      type: 'user-said',
      text: 'hello',
      requestId: 'snd-1',
    })
    expect((await threadRow())?.head).toBe(1)
    expect(await sandboxRows()).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(serve).not.toHaveBeenCalled()
  })

  it('does not append twice when the same sendId is retried', async () => {
    const { service, dispatch } = messagesWith()

    await service.send(ARGS)
    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect((await threadRow())?.head).toBe(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('appends a different send after the first and does not dispatch again while booting', async () => {
    const { service, dispatch } = messagesWith()

    await service.send(ARGS)
    await service.send({ ...ARGS, sendId: 'snd-2', text: 'more' })

    expect((await eventsOf()).map((event) => event.seq)).toEqual([1, 2])
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('appends without dispatching while a claim is already active', async () => {
    await seedSandboxRow()
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('appends without claiming while a running sandbox is still parking', async () => {
    await seedSandboxRow({
      state: 'running',
      wakeClaim: null,
      serveUrl: 'https://serve.example.test',
    })
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(dispatch).not.toHaveBeenCalled()
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
  })

  it('re-claims a failed row for a new message', async () => {
    await seedSandboxRow({ wakeClaim: null, wakeFailedAt: new Date() })
    const { service, dispatch } = messagesWith()

    await service.send(ARGS)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect((await sandboxRows())[0]?.wakeClaim).not.toBeNull()
  })

  it('keeps the message, records a step and stays Queued on a credential gap', async () => {
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { service, dispatch } = messagesWith({ scoped })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(await bootSteps()).toMatchObject([
      { step: EBootStep.Provision, state: 'error', error: failure.message },
    ])
    expect(await sandboxRows()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('keeps the message and stays Queued when dispatch throws', async () => {
    const dispatcher = fakeDispatcher({ failWith: new Error('trigger is down') })
    const { service } = messagesWith({ dispatcher })

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
  })
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
