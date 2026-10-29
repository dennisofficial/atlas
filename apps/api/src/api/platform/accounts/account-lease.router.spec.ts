import { useTestDatabase } from '@dltech/atlas-db/testing'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { as, createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { SessionOrSandboxMiddleware } from '../sessions/session-or-sandbox.middleware'
import { AccountLeaseRouter } from './account-lease.router'
import { AccountsService } from './accounts.service'

const LEASE = '/v1/trpc/accountLease.get'
const asked: string[] = []

describe('AccountLeaseRouter', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: 100_000,
      providers: [
        AccountLeaseRouter,
        SessionOrSandboxMiddleware,
        {
          provide: AccountsService,
          useValue: {
            lease: async ({ userId }: { userId: string }) => {
              asked.push(userId)
              return {
                accounts: [
                  {
                    id: 'acc_1',
                    provider: 'openrouter',
                    kind: 'api-key',
                    origin: 'login',
                    label: 'key',
                    status: 'active',
                    createdAt: '2026-10-01T00:00:00.000Z',
                    updatedAt: '2026-10-01T00:00:00.000Z',
                    secret: { kind: 'api-key', apiKey: 'sk-1' },
                  },
                ],
                active: [{ provider: 'openrouter', accountId: 'acc_1' }],
              }
            },
          },
        },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer session') return null
              return { userId: 'user-s', sessionId: 's', email: '' }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              if (args.token === 'pod') {
                return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'user-p' }
              }
              if (args.token === 'sandbox') {
                return {
                  kind: ETokenPrincipalKind.Sandbox,
                  id: 'sbx-1',
                  threadId: 'thr-1',
                  userId: 'user-x',
                }
              }
              throw new UnauthorizedException()
            },
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    asked.length = 0
    await seedUsers('user-s')
  })

  it('leases to a session with Cache-Control: no-store and every field kept', async () => {
    const reply = await request(app.getHttpServer()).get(LEASE).set(as('session'))

    expect(reply.status).toBe(200)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(reply.body.result.data.accounts[0]).toMatchObject({
      id: 'acc_1',
      origin: 'login',
      secret: { kind: 'api-key', apiKey: 'sk-1' },
    })
    expect(reply.body.result.data.active).toEqual([{ provider: 'openrouter', accountId: 'acc_1' }])
    expect(asked).toEqual(['user-s'])
  })

  it('leases to a pod token and to a sandbox token without a thread id', async () => {
    const pod = await request(app.getHttpServer()).get(LEASE).set(as('pod'))
    const sandbox = await request(app.getHttpServer()).get(LEASE).set(as('sandbox'))

    expect(pod.status).toBe(200)
    expect(sandbox.status).toBe(200)
    expect(sandbox.headers['cache-control']).toBe('no-store')
    expect(asked).toEqual(['user-p', 'user-x'])
  })

  it('answers 401 without a credential and for an unknown bearer', async () => {
    expect((await request(app.getHttpServer()).get(LEASE)).status).toBe(401)
    expect((await request(app.getHttpServer()).get(LEASE).set(as('nope'))).status).toBe(401)
    expect(asked).toEqual([])
  })
})
