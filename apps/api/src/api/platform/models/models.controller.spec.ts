import type { INestApplication } from '@nestjs/common'
import { VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { ModelsController } from './models.controller'
import { ModelsService } from './models.service'

describe('ModelsController', () => {
  let app: INestApplication
  const asked: string[] = []

  beforeEach(async () => {
    asked.length = 0
    const module = await Test.createTestingModule({
      controllers: [ModelsController],
      providers: [
        SessionAuthGuard,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer good') return null
              return { userId: 'user-a', sessionId: 's', email: '', activeOrganizationId: null }
            },
          },
        },
        {
          provide: ModelsService,
          useValue: {
            list: async ({ userId }: { userId: string }) => {
              asked.push(userId)
              return { providers: [] }
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('answers 401 without a session', async () => {
    await request(app.getHttpServer()).get('/v1/models').expect(401)
    expect(asked).toEqual([])
  })

  it('serves the signed-in user’s models at GET /v1/models', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/models')
      .set({ authorization: 'Bearer good' })
      .expect(200)

    expect(response.body).toEqual({ providers: [] })
    expect(asked).toEqual(['user-a'])
  })
})
