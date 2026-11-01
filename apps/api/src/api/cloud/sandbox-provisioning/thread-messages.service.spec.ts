import { EBootStep, EBootStepState, EThreadMessageState } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { applyPodEvents } from '../../platform/sandboxes/pod-events'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { DISPATCH_FAILED_MESSAGE } from './pod-launch.service'
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
import { inertSignals, recordingSignals } from '../../platform/sessions/thread-signals.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const

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

  it('appends a user-said event, claims and dispatches when nothing runs', async () => {
    const { service, dispatch } = messagesWith()

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
  })

  it('stores images on the appended event', async () => {
    const { service } = messagesWith()
    const images = [{ path: 'shot.png', mediaType: 'image/png', data: 'aGk=' }]

    await service.send({ ...ARGS, images })

    const [event] = await eventsOf()
    expect(JSON.parse(event?.body ?? '').images).toEqual(images)
  })

  it("does not send to another user's thread", async () => {
    const { service, dispatch } = messagesWith()

    await expect(service.send({ ...ARGS, userId: 'usr-2' })).rejects.toThrow('thread not found')

    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
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
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Running }],
    })
    await applyPodEvents({
      signals: inertSignals(),
      threadId: 'thr-1',
      events: [podAnswer(2), podAnswer(3)],
    })
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
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

  it('keeps the message, records a step and answers plain Queued on a credential gap', async () => {
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { service, dispatch } = messagesWith({ scoped })

    const reply = await service.send(ARGS)

    expect(reply).toEqual({ state: EThreadMessageState.Queued })
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

  it('keeps the message, releases the claim and reports the failure when dispatch throws', async () => {
    const dispatcher = fakeDispatcher({ failWith: new Error('trigger is down') })
    const { service } = messagesWith({ dispatcher })

    expect(await service.send(ARGS)).toEqual({
      state: EThreadMessageState.Queued,
      error: DISPATCH_FAILED_MESSAGE,
    })

    expect(await eventsOf()).toHaveLength(1)
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
  })

  it('ticks the pod root when a teammate thread gets a message', async () => {
    await db.orm.public.Session.create({
      id: 'ses_tm-1',
      userId: 'usr-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      managedBySessionId: 'ses_thr-1',
    })
    await db.orm.public.Thread.create({
      id: 'thr-tm-1',
      userId: 'usr-1',
      sessionId: 'ses_tm-1',
      spawnerThreadId: 'thr-1',
      agentType: 'teammate',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.orm.public.Session.where({ id: 'ses_tm-1' }).update({ mainThreadId: 'thr-tm-1' })
    await db.orm.public.CloudSandbox.create({
      id: 'sbx-tm-1',
      sessionId: 'ses_thr-1',
      userId: 'usr-1',
      sandboxId: 'sbx',
      name: 'atlas-thread-1',
      region: 'iad1',
      state: 'running',
      serveUrl: 'https://serve.example.test',
      tokenHash: 'hash',
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Done }],
    })
    const recorded = recordingSignals()
    const rootFrames = recorded.framesOf('thr-1')
    const childFrames = recorded.framesOf('thr-tm-1')
    const { service } = messagesWith({ signals: recorded.signals })

    await service.send({ ...ARGS, threadId: 'thr-tm-1' })

    expect(childFrames.some((frame) => frame.type === 'events')).toBe(true)
    expect(rootFrames.some((frame) => frame.type === 'heartbeat')).toBe(true)
  })
})
