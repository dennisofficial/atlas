import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import { AccountsRouter } from '../src/api/platform/accounts/accounts.router'
import { createMixedApp } from '../src/api/platform/accounts/accounts.router.fixture'
import { SessionMiddleware } from '../src/_module/session/session.middleware'
import { SecretsRouter } from '../src/api/cloud/secrets/secrets.router'
import { SecretsService } from '../src/api/cloud/secrets/secrets.service'
import { AccountsService } from '../src/api/platform/accounts/accounts.service'
import { SandboxesService } from '../src/api/platform/sandboxes/sandboxes.service'
import { SessionOrSandboxMiddleware } from '../src/api/platform/sessions/session-or-sandbox.middleware'

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
  list: vi.fn(async () => [
    { name: 'web.searchKey', value: 'sk-1', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]),
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
    app = await createMixedApp({
      providers: [
        AccountsRouter,
        SecretsRouter,
        { provide: SecretsService, useValue: secretsStub },
        { provide: AccountsService, useValue: accountsStub },
        SessionMiddleware,
        SessionOrSandboxMiddleware,
        { provide: SandboxesService, useValue: { verifyTokenPrincipal: vi.fn(async () => null) } },
        { provide: SESSION_VERIFIER, useValue: verifier },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('refuses a bearer that is neither a session nor a registered sandbox or pod on secrets.list', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/trpc/secrets.list')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)

    expect(response.status).toBe(401)
    expect(secretsStub.list).not.toHaveBeenCalled()
  })

  it('refuses a sandbox token on accounts.get and accounts.replaceSecret', async () => {
    const server = app.getHttpServer()

    const read = await request(server)
      .get('/v1/trpc/accounts.get')
      .query({ input: JSON.stringify({ accountId: 'acc_1' }) })
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
    const rotate = await request(server)
      .post('/v1/trpc/accounts.replaceSecret')
      .set('authorization', `Bearer ${SANDBOX_TOKEN}`)
      .send({ accountId: 'acc_1', secret: { kind: 'api-key', apiKey: 'sk-ant-test' } })

    expect(read.status).toBe(401)
    expect(rotate.status).toBe(401)
    expect(accountsStub.read).not.toHaveBeenCalled()
    expect(accountsStub.replaceSecret).not.toHaveBeenCalled()
  })

  it('still answers the same routes for a user session', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/trpc/secrets.list')
      .set('authorization', `Bearer ${USER_SESSION}`)

    expect(response.status).toBe(200)
  })
})
