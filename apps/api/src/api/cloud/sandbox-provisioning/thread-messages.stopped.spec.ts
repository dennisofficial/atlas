import { EBootStep, EBootStepState, EThreadMessageState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ServeProtocolRefusedError } from './serve-send'
import {
  eventsOf,
  messagesWith,
  seedProvisionedRow,
  seedThread,
} from './sandbox-provisioning.fixture'

const ARGS = {
  userId: 'usr-1',
  threadId: 'thr-1',
  sendId: 'snd-1',
  text: 'hello',
} as const
const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }
const CLOSED = new Error('serve closed the connection before acknowledging the message')

describe('ThreadMessagesService.send to a sandbox Vercel stopped', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
    await seedProvisionedRow({
      state: 'running',
      wakeClaim: null,
      serveUrl: ENDPOINT.url,
    })
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Agent, state: EBootStepState.Done }],
    })
  })

  it('parks, keeps the message and relaunches when Vercel reports the sandbox not running', async () => {
    const { service, park, dispatch, observedRunning } = messagesWith({
      endpoint: ENDPOINT,
      serveFails: CLOSED,
      observedRunning: vi.fn(async () => false),
    })

    expect(await service.send(ARGS)).toEqual({
      state: EThreadMessageState.Queued,
    })

    expect(observedRunning).toHaveBeenCalledWith({ threadId: 'thr-1' })
    expect(park).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'the sandbox stopped without reporting it',
      }),
    )
    const [event] = await eventsOf()
    expect(JSON.parse(event?.body ?? '')).toMatchObject({
      type: 'user-said',
      requestId: 'snd-1',
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('answers 502 when Vercel says the sandbox is still running', async () => {
    const { service, park, dispatch } = messagesWith({
      endpoint: ENDPOINT,
      serveFails: CLOSED,
    })

    await expect(service.send(ARGS)).rejects.toMatchObject({ status: 502 })

    expect(park).not.toHaveBeenCalled()
    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers 502 when inspecting the sandbox fails', async () => {
    const { service, park } = messagesWith({
      endpoint: ENDPOINT,
      serveFails: CLOSED,
      observedRunning: vi.fn(async () => {
        throw new Error('vercel down')
      }),
    })

    await expect(service.send(ARGS)).rejects.toMatchObject({ status: 502 })
    expect(park).not.toHaveBeenCalled()
  })

  it('does not ask Vercel when serve refuses the protocol', async () => {
    const { service, park, observedRunning } = messagesWith({
      endpoint: ENDPOINT,
      serveFails: new ServeProtocolRefusedError('newer protocol'),
    })

    expect(await service.send(ARGS)).toEqual({
      state: EThreadMessageState.Queued,
    })

    expect(observedRunning).not.toHaveBeenCalled()
    expect(park).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "the sandbox is restarting to pick up this Atlas's serve",
      }),
    )
  })
})
