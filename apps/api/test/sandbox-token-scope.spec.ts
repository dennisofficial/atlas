import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { AccountsController } from '../src/api/platform/accounts/accounts.controller'
import { AccountsService } from '../src/api/platform/accounts/accounts.service'
import { SecretsController } from '../src/api/cloud/secrets/secrets.controller'
import { SecretsService } from '../src/api/cloud/secrets/secrets.service'

vi.mock('../src/db', () => ({ db: {} }))

const SANDBOX_TOKEN = 'sandbox-token'
const USER_SESSION = 'user-session-token'

// A sandbox token is client-minted for remote control, so the verifier never resolves it to a
// user session; a credential backup route guarded by SessionAuthGuard refuses it outright.
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

describe('sandbox token scoping (in-process, real guard)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SecretsController, AccountsController],
      providers: [
        { provide: SecretsService, useValue: secretsStub },
        { provide: AccountsService, useValue: accountsStub },
        SessionAuthGuard,
        Reflector,
        { provide: SESSION_VERIFIER, useValue: verifier },
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

    expect(response.status).toBe(401)
    expect(secretsStub.list).not.toHaveBeenCalled()
  })

  it('refuses a sandbox token on GET /accounts and PUT /accounts/:id/secret', async () => {
    const server = app.getHttpServer()

    const read = await request(server)
      .get('/accounts/acc_1')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
    const rotate = await request(server)
      .put('/accounts/acc_1/secret')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
      .send({ secret: { kind: 'api-key', apiKey: 'sk-ant-test' } })

    expect(read.status).toBe(401)
    expect(rotate.status).toBe(401)
    expect(accountsStub.read).not.toHaveBeenCalled()
    expect(accountsStub.replaceSecret).not.toHaveBeenCalled()
  })

  it('still answers the same routes for a user session', async () => {
    const response = await request(app.getHttpServer())
      .get('/secrets')
      .set('authorization', `Bearer ${USER_SESSION}`)

    expect(response.status).toBe(200)
  })
})
