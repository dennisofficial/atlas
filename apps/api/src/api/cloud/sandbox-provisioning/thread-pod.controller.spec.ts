import type { INestApplication } from '@nestjs/common'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  channelTicketValid,
  EBootStep,
  EBootStepState,
  EPodState,
  podConnectReplySchema,
  podStatusSchema,
  threadPodConnectPath,
  threadPodPath,
} from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ThreadPodController } from './thread-pod.controller'
import { ThreadPodService } from './thread-pod.service'
import { realEndpoints, SERVE_TOKEN, SERVE_URL, seedServingPod } from './thread-pod.fixture'

const as = (token: string) => ({ authorization: `Bearer ${token}` })

describe('ThreadPodController', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ThreadPodController],
      providers: [
        SessionAuthGuard,
        ThreadPodService,
        { provide: SandboxEndpointService, useValue: realEndpoints() },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const user = { 'Bearer session-a': 'usr-1', 'Bearer session-b': 'usr-2' }[
                req.headers.authorization ?? ''
              ]
              if (user === undefined) return null
              return { userId: user, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  const get = (token?: string) => {
    const call = request(app.getHttpServer()).get(threadPodPath('thr-1'))
    return token === undefined ? call : call.set(as(token))
  }

  it('answers 401 without a session', async () => {
    expect((await get()).status).toBe(401)
  })

  it("answers 404 for someone else's thread", async () => {
    expect((await get('session-b')).status).toBe(404)
  })

  it('answers the owner the pod status in wire shape', async () => {
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Error, error: 'no credential' }],
    })

    const reply = await get('session-a')

    expect(reply.status).toBe(200)
    const pod = podStatusSchema.parse(reply.body)
    expect(pod.state).toBe(EPodState.Failed)
    expect(pod.steps).toMatchObject([
      { step: EBootStep.Provision, state: EBootStepState.Error, error: 'no credential' },
    ])
  })

  describe('POST connect', () => {
    const post = (token?: string) => {
      const call = request(app.getHttpServer()).post(threadPodConnectPath('thr-1'))
      return token === undefined ? call : call.set(as(token))
    }

    it('answers 401 without a session', async () => {
      expect((await post()).status).toBe(401)
    })

    it("answers 404 for someone else's thread", async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      expect((await post('session-b')).status).toBe(404)
    })

    it('answers 409 pod-not-running when nothing is running', async () => {
      const reply = await post('session-a')

      expect(reply.status).toBe(409)
      expect(reply.body).toMatchObject({ code: 'pod-not-running' })
    })

    it('answers 409 pod-not-running for a parked pod', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1', state: 'parked' })

      expect((await post('session-a')).status).toBe(409)
    })

    it('answers 200 with a ticket for the serve token, and never the token itself', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      const reply = await post('session-a')

      expect(reply.status).toBe(200)
      const connect = podConnectReplySchema.parse(reply.body)
      expect(connect.url).toBe(SERVE_URL)
      expect(
        channelTicketValid({
          serveToken: SERVE_TOKEN,
          threadId: 'thr-1',
          ticket: connect.token,
          nowMs: Date.now(),
        }),
      ).toBe(true)
      expect(JSON.stringify(reply.body)).not.toContain(SERVE_TOKEN)
      expect(reply.text).not.toContain(SERVE_TOKEN)
    })
  })
})
