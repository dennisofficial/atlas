import type { NestExpressApplication } from '@nestjs/platform-express'
import { EBootStep, EBootStepState, EThreadMessageState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { callMutation, createRouterApp } from './sandbox-provisioning.router.fixture'
import { eventsOf, messagesWith, seedThread, threadRow } from './sandbox-provisioning.fixture'
import { ThreadMessagesRouter } from './thread-messages.router'
import { TAKE_BACK_TOO_LATE_MESSAGE, ThreadMessagesService } from './thread-messages.service'

const ENDPOINT = { token: 'tok', url: 'https://serve.example.test' }
const SEND = { threadId: 'thr-1', sendId: 'snd-1', text: 'hello' }

type Target = { token?: string; input?: unknown; app?: NestExpressApplication }

describe('ThreadMessagesRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication
  let runningApp: NestExpressApplication
  let serve: ReturnType<typeof messagesWith>['serve']

  const appOver = (service: ThreadMessagesService) =>
    createRouterApp([ThreadMessagesRouter, { provide: ThreadMessagesService, useValue: service }])

  beforeAll(async () => {
    app = await appOver(messagesWith().service)
    const running = messagesWith({ endpoint: ENDPOINT })
    serve = running.serve
    runningApp = await appOver(running.service)
  })

  afterAll(async () => {
    await app.close()
    await runningApp.close()
  })

  beforeEach(async () => {
    serve.mockClear()
    await seedThread()
    await seedUsers('usr-2')
  })

  const call = (procedure: string, target: Target) =>
    callMutation({
      app: target.app ?? app,
      procedure,
      input: target.input ?? SEND,
      ...(target.token === undefined ? {} : { token: target.token }),
    })
  const send = (target: Target) => call('threadMessages.send', target)
  const takeBack = (target: Target) =>
    call('threadMessages.takeBack', {
      ...target,
      input: target.input ?? { threadId: 'thr-1', sendId: 'snd-1' },
    })

  describe('send', () => {
    it('answers 401 without a session', async () => {
      expect((await send({})).status).toBe(401)
    })

    it.each([
      ['an empty sendId', { ...SEND, sendId: '' }],
      ['a sendId over 200 characters', { ...SEND, sendId: 's'.repeat(201) }],
      ['empty text', { ...SEND, text: '' }],
      ['text over 100000 characters', { ...SEND, text: 't'.repeat(100_001) }],
      ['an empty thread id', { ...SEND, threadId: '' }],
      ['a missing text', { threadId: 'thr-1', sendId: 'snd-1' }],
    ])('answers 400 for %s', async (_name, input) => {
      const reply = await send({ token: 'session-a', input })

      expect(reply.status).toBe(400)
      expect(await eventsOf()).toHaveLength(0)
    })

    it("answers 404 for someone else's thread", async () => {
      expect((await send({ token: 'session-b', app: runningApp })).status).toBe(404)
      expect(serve).not.toHaveBeenCalled()
    })

    it('answers Queued and appends the message when no sandbox runs', async () => {
      const reply = await send({ token: 'session-a' })

      expect(reply.status).toBe(200)
      expect(reply.body.result.data).toEqual({ state: EThreadMessageState.Queued })
      expect(await eventsOf()).toHaveLength(1)
    })

    it('answers Delivered when the sandbox is running', async () => {
      const reply = await send({ token: 'session-a', app: runningApp })

      expect(reply.status).toBe(200)
      expect(reply.body.result.data).toEqual({ state: EThreadMessageState.Delivered })
      expect(serve).toHaveBeenCalledWith({ ...ENDPOINT, ...SEND })
    })

    it('hands the images of a send to serve', async () => {
      const images = [{ path: 'shot.png', mediaType: 'image/png', data: 'aGk=' }]

      const reply = await send({ token: 'session-a', app: runningApp, input: { ...SEND, images } })

      expect(reply.status).toBe(200)
      expect(serve).toHaveBeenCalledWith({ ...ENDPOINT, ...SEND, images })
    })

    it('answers 400 for more than 10 images', async () => {
      const image = { path: 'a.png', mediaType: 'image/png', data: 'aGk=' }

      const reply = await send({
        token: 'session-a',
        input: { ...SEND, images: Array.from({ length: 11 }, () => image) },
      })

      expect(reply.status).toBe(400)
    })

    it('answers 502 when delivery to a running sandbox fails', async () => {
      const failing = await appOver(
        messagesWith({ endpoint: ENDPOINT, serveFails: new Error('socket down') }).service,
      )

      const reply = await send({ token: 'session-a', app: failing })
      await failing.close()

      expect(reply.status).toBe(502)
    })
  })

  describe('takeBack', () => {
    it('answers 401 without a session', async () => {
      expect((await takeBack({})).status).toBe(401)
    })

    it.each([
      ['an empty sendId', { threadId: 'thr-1', sendId: '' }],
      ['an empty thread id', { threadId: '', sendId: 'snd-1' }],
      ['a missing sendId', { threadId: 'thr-1' }],
    ])('answers 400 for %s', async (_name, input) => {
      expect((await takeBack({ token: 'session-a', input })).status).toBe(400)
    })

    it("answers 404 for someone else's thread", async () => {
      await send({ token: 'session-a' })

      expect((await takeBack({ token: 'session-b' })).status).toBe(404)
      expect(await eventsOf()).toHaveLength(1)
    })

    it('deletes the unrun last message and winds the head back', async () => {
      await send({ token: 'session-a' })

      const reply = await takeBack({ token: 'session-a' })

      expect(reply.status).toBe(200)
      expect(reply.body.result.data).toBeUndefined()
      expect(await eventsOf()).toHaveLength(0)
      expect((await threadRow())?.head).toBe(0)
    })

    it('answers 404 for a message that was never sent', async () => {
      const reply = await takeBack({ token: 'session-a' })

      expect(reply.status).toBe(404)
      expect(reply.body.error.message).toBe('message not found')
    })

    it('answers 409 when the sandbox already picked the message up', async () => {
      await send({ token: 'session-a' })
      await recordBootSteps({
        threadId: 'thr-1',
        steps: [{ step: EBootStep.Agent, state: EBootStepState.Running }],
      })

      const reply = await takeBack({ token: 'session-a' })

      expect(reply.status).toBe(409)
      expect(reply.body.error.message).toBe(TAKE_BACK_TOO_LATE_MESSAGE)
      expect(await eventsOf()).toHaveLength(1)
    })

    it('answers 409 when a sandbox is running', async () => {
      const reply = await takeBack({ token: 'session-a', app: runningApp })

      expect(reply.status).toBe(409)
      expect(reply.body.error.message).toBe(TAKE_BACK_TOO_LATE_MESSAGE)
    })
  })
})
