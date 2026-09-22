import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import { AccountsController } from '../src/api/accounts/accounts.controller'
import { AccountsService } from '../src/api/accounts/accounts.service'
import { BrokerService } from '../src/api/accounts/broker.service'
import { SandboxesService } from '../src/api/sandboxes/sandboxes.service'
import { SecretsController } from '../src/api/secrets/secrets.controller'
import { SecretsService } from '../src/api/secrets/secrets.service'
import { SessionOrSandboxGuard } from '../src/api/sessions/session-or-sandbox.guard'

vi.mock('../src/db', () => ({ db: {} }))

const SANDBOX_TOKEN = 'sandbox-token'
const USER_SESSION = 'user-session-token'

const sandboxes = {
  verifyTokenPrincipal: vi.fn(async (args: { token: string }) => {
    if (args.token !== SANDBOX_TOKEN) throw new Error('nope')
    return { id: 'sbx_1', threadId: 'brn_1', userId: 'user-a' }
  }),
  assertThreadInFamily: vi.fn(async () => undefined),
}

const verifier = {
  verify: vi.fn(async (request: { headers: Record<string, string> }) => {
    if (request.headers.authorization !== `Bearer ${USER_SESSION}`) return null
    return {
      userId: 'user-a',
      sessionId: 'ses_1',
      email: 'dennis@trycomp.ai',
      activeOrganizationId: null,
    }
  }),
}

const secretsStub = {
  list: vi.fn(async () => [{ name: 'web.searchKey', value: 'sk-1', updatedAt: '2026-01-01T00:00:00.000Z' }]),
  set: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}

const accountsStub = {
  list: vi.fn(async () => []),
  read: vi.fn(async () => ({ id: 'acc_1' })),
  add: vi.fn(),
  setActive: vi.fn(),
  activeFor: vi.fn(),
  replaceSecret: vi.fn(),
  setStatus: vi.fn(),
  remove: vi.fn(),
}

const brokerStub = { accessToken: vi.fn(async () => ({ accessToken: 'at', expiresAt: null })) }

describe('sandbox token scoping (in-process, real guard)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SecretsController, AccountsController],
      providers: [
        { provide: SecretsService, useValue: secretsStub },
        { provide: AccountsService, useValue: accountsStub },
        { provide: BrokerService, useValue: brokerStub },
        SessionOrSandboxGuard,
        Reflector,
        { provide: SESSION_VERIFIER, useValue: verifier },
        { provide: SandboxesService, useValue: sandboxes },
      ],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('refuses a sandbox token on GET /secrets (the GH-198 repro)', async () => {
    const response = await request(app.getHttpServer())
      .get('/secrets')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)

    expect(response.status).toBe(403)
    expect(secretsStub.list).not.toHaveBeenCalled()
  })

  it('refuses a sandbox token on GET /accounts/:id and POST /accounts/:id/access-token', async () => {
    const read = await request(app.getHttpServer())
      .get('/accounts/acc_1')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
    const mint = await request(app.getHttpServer())
      .post('/accounts/acc_1/access-token')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
      .send({})

    expect(read.status).toBe(403)
    expect(mint.status).toBe(403)
    expect(accountsStub.read).not.toHaveBeenCalled()
    expect(brokerStub.accessToken).not.toHaveBeenCalled()
  })

  it('still answers the same routes for a user session', async () => {
    const response = await request(app.getHttpServer())
      .get('/secrets')
      .set('authorization', `Bearer ${USER_SESSION}`)

    expect(response.status).toBe(200)
  })
})
