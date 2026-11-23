import { EClassifierFault } from '@dltech/atlas-core'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import request from 'supertest'

import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { as, createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import { ClassifierRouter } from './classifier.router'
import { ClassifierService, type ClassifierTestResult } from './classifier.service'

const USERS: Record<string, string> = { 'token-a': 'user-a' }

describe('ClassifierRouter', () => {
  let app: INestApplication
  const asked: string[] = []
  let reply: ClassifierTestResult = { ok: true, model: 'typesafe-ai/jev', ms: 42 }
  const fakeService = {
    async test(args: { userId: string }): Promise<ClassifierTestResult> {
      asked.push(args.userId)
      return reply
    },
  }
  const mutate = (token: string | undefined) => {
    const call = request(app.getHttpServer()).post('/v1/trpc/classifier.test')
    const authed = token === undefined ? call : call.set(as(token))
    return authed.set('Content-Type', 'application/json').send({})
  }

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: 100_000,
      providers: [
        ClassifierRouter,
        { provide: ClassifierService, useValue: fakeService },
        SessionMiddleware,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = USERS[(req.headers.authorization ?? '').replace(/^Bearer /, '')]
              if (userId === undefined) return null
              return { userId, sessionId: 's', email: '' }
            },
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    asked.length = 0
    reply = { ok: true, model: 'typesafe-ai/jev', ms: 42 }
  })

  it('answers 401 without a session', async () => {
    expect((await mutate(undefined)).status).toBe(401)
    expect(asked).toEqual([])
  })

  it('tests the classifier for the signed-in user', async () => {
    const response = await mutate('token-a').expect(200)

    expect(asked).toEqual(['user-a'])
    expect(response.body.result.data).toEqual({ ok: true, model: 'typesafe-ai/jev', ms: 42 })
  })

  it('carries a fault back to the page', async () => {
    reply = { ok: false, fault: EClassifierFault.Rejected, detail: '401: refused' }

    const response = await mutate('token-a').expect(200)

    expect(response.body.result.data).toEqual({
      ok: false,
      fault: 'rejected',
      detail: '401: refused',
    })
  })
})
