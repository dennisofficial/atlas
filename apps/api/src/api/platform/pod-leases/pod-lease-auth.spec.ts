import type { INestApplication } from '@nestjs/common'
import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { OauthConnectionsController } from '../oauth-connections/oauth-connections.controller'
import {
  FakeClock,
  FakeIssuer,
  FakeStore,
  grantOf,
} from '../oauth-connections/oauth-connections.fakes'
import { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'
import {
  OauthClock,
  OauthConnectionStore,
  OauthIssuer,
} from '../oauth-connections/oauth-connections.types'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import { PodLeasesController } from './pod-leases.controller'
import { PodLeasesService } from './pod-leases.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const START = Date.parse('2026-10-05T12:00:00.000Z')
const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
}

const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get('plain')
  @UseGuards(SessionOrSandboxGuard)
  plain(): { ok: true } {
    return { ok: true }
  }

  @Get('plain/:threadId')
  @UseGuards(SessionOrSandboxGuard)
  plainThread(): { ok: true } {
    return { ok: true }
  }

  @Get('pod')
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  pod(): { ok: true } {
    return { ok: true }
  }
}

describe('pod lease bearer on the HTTP surface', () => {
  let app: INestApplication
  let store: FakeStore
  const leases = { register: vi.fn(async () => undefined), release: vi.fn(async () => undefined) }

  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })
  const upload = (token: string) =>
    http()
      .put('/v1/oauth-connections/conn-1')
      .set(as(token))
      .send({ provider: 'anthropic', tokens: grantOf(START) })

  beforeEach(async () => {
    store = new FakeStore()
    leases.register.mockClear()
    const module = await Test.createTestingModule({
      controllers: [OauthConnectionsController, PodLeasesController, ProbeController],
      providers: [
        OauthConnectionsService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
        { provide: PodLeasesService, useValue: leases },
        { provide: OauthConnectionStore, useValue: store },
        { provide: OauthIssuer, useValue: new FakeIssuer() },
        { provide: OauthClock, useValue: new FakeClock(START) },
        {
          provide: SecretCipherService,
          useValue: new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
        },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = SESSIONS[bearerOf(req)]
              if (userId === undefined) return null
              return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              const pod = POD_TOKENS[args.token]
              if (pod === undefined) throw new UnauthorizedException()
              return { kind: ETokenPrincipalKind.Pod, ...pod }
            },
            async assertThreadInFamily() {
              throw new Error('a pod principal must never reach the thread-family check')
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

  afterEach(() => app.close())

  it("leases an access token for its own user's connection with no sandbox row or assignment", async () => {
    await upload('session-a').expect(200)
    expect(store.sandboxes.size).toBe(0)
    expect(store.assignments.size).toBe(0)

    const issued = await http()
      .post('/v1/oauth-connections/conn-1/access-token')
      .set(as('pod-token-a'))
      .send({})
      .expect(200)

    expect(issued.headers['cache-control']).toBe('no-store')
    expect(issued.body).toMatchObject({ accessToken: 'access-0', generation: 0 })
    expect(JSON.stringify(issued.body)).not.toContain('refresh-0')
  })

  it("cannot lease another user's connection", async () => {
    await http()
      .put('/v1/oauth-connections/conn-1')
      .set(as('session-b'))
      .send({ provider: 'anthropic', tokens: grantOf(START) })
      .expect(200)

    await http()
      .post('/v1/oauth-connections/conn-1/access-token')
      .set(as('pod-token-a'))
      .send({})
      .expect(404)
  })

  it('is refused on a route that is not @PodReachable, threadless or not', async () => {
    await http().get('/v1/probe/plain').set(as('pod-token-a')).expect(403)
    await http().get('/v1/probe/plain/thread-pod-a').set(as('pod-token-a')).expect(403)
    await http().get('/v1/probe/pod').set(as('pod-token-a')).expect(200)
  })

  it('is unauthorized on the session-only lease routes and on connection management', async () => {
    await http()
      .put('/v1/pod-leases/thread-pod-a')
      .set(as('pod-token-a'))
      .send({ token: 'x' })
      .expect(401)
    await http().delete('/v1/pod-leases/thread-pod-a').set(as('pod-token-a')).expect(401)
    await upload('pod-token-a').expect(401)
    expect(leases.register).not.toHaveBeenCalled()
  })
})
