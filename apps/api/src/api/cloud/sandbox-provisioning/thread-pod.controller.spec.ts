import type { INestApplication } from '@nestjs/common'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  EBootStep,
  EBootStepState,
  EPodState,
  podStatusSchema,
  threadPodPath,
} from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ThreadPodController } from './thread-pod.controller'
import { ThreadPodService } from './thread-pod.service'

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
})
