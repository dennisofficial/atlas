import { EBootStep, EThreadMessageState } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { applyPodEvents } from '../../platform/sandboxes/pod-events'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import {
  bootSteps,
  eventsOf,
  fakeDispatcher,
  fakeScoped,
  messagesWith,
  sandboxRows,
  seedProvisionedRow,
  seedThread,
  threadRow,
} from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }
const _SAID = (sendId: string, text: string) =>
  JSON.stringify({ type: 'user-said', text, requestId: sendId })

const podAnswer = (seq: number) => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: JSON.stringify({ type: 'assistant-said', parts: [] }),
})

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
    await seedProvisionedRow()
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('appends after the pod answer a parked pod flushed, continuing its seq', async () => {
    const { service, dispatch } = messagesWith()
    await service.send(ARGS)
    await applyPodEvents({ threadId: 'thr-1', events: [podAnswer(2), podAnswer(3)] })
    await db.orm.public.CloudSandbox.where({ threadId: 'thr-1' }).update({
      state: 'parked',
      wakeClaim: null,
      wakeFailedAt: null,
    })

    await service.send({ ...ARGS, sendId: 'snd-2', text: 'follow up' })

    expect((await eventsOf()).map((event) => [event.seq, event.type])).toEqual([
      [1, 'user-said'],
      [2, 'assistant-said'],
      [3, 'assistant-said'],
      [4, 'user-said'],
    ])
    expect((await threadRow())?.head).toBe(4)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('re-claims a failed row for a new message', async () => {
    await seedProvisionedRow({ wakeClaim: null, wakeFailedAt: new Date() })
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
      {
        step: EBootStep.Provision,
        state: 'error',
        error: failure.message,
        gap: EVercelCredentialGap.UserCredential,
      },
    ])
    expect(await sandboxRows()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('keeps the message and releases the claim when dispatch throws', async () => {
    const dispatcher = fakeDispatcher({ failWith: new Error('trigger is down') })
    const { service } = messagesWith({ dispatcher })

    await service.send(ARGS)

    expect(await eventsOf()).toHaveLength(1)
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
  })
})
