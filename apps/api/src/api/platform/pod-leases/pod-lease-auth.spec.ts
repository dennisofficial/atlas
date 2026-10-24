import type { NestExpressApplication } from '@nestjs/platform-express'
import { Query, Router, UseMiddlewares } from 'nestjs-trpc'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { meta } from '../../../_module/trpc/procedure-meta'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { SessionOrSandboxMiddleware } from '../sessions/session-or-sandbox.middleware'
import { FakeStore, grantOf } from '../oauth-connections/oauth-connections.fakes'
import {
  createOauthApp,
  mutate,
  oauthProviders,
  principalSandboxes,
  START,
} from '../oauth-connections/oauth-connections.router.fixture'
import { PodLeasesRouter } from './pod-leases.router'
import { PodLeasesService } from './pod-leases.service'

const POD_PRINCIPALS = {
  'pod-token-a': { kind: ETokenPrincipalKind.Pod, threadId: 'thread-pod-a', userId: 'user-a' },
}

const ok = z.object({ ok: z.literal(true) })
const threaded = z.object({ threadId: z.string() })

@Router({ alias: 'probe' })
@UseMiddlewares(SessionOrSandboxMiddleware)
class ProbeRouter {
  @Query({ output: ok })
  plain(): { ok: true } {
    return { ok: true }
  }

  @Query({ input: threaded, output: ok })
  plainThread(): { ok: true } {
    return { ok: true }
  }

  @Query({ output: ok, meta: meta({ podReachable: true }) })
  pod(): { ok: true } {
    return { ok: true }
  }
}

describe('pod lease bearer on the tRPC surface', () => {
  let app: NestExpressApplication
  let store: FakeStore
  const leases = { register: vi.fn(async () => undefined), release: vi.fn(async () => undefined) }

  const upload = (token: string, connectionId = 'conn-1') =>
    mutate({
      app,
      procedure: 'oauthConnections.upload',
      token,
      body: { connectionId, provider: 'anthropic', tokens: grantOf(START) },
    })
  const mint = (token: string) =>
    mutate({
      app,
      procedure: 'oauthConnections.accessToken',
      token,
      body: { connectionId: 'conn-1' },
    })

  beforeEach(async () => {
    store = new FakeStore()
    leases.register.mockClear()
    leases.release.mockClear()
    app = await createOauthApp(
      oauthProviders({
        store,
        sandboxes: principalSandboxes({
          principals: POD_PRINCIPALS,
          assertThreadInFamily: async () => {
            throw new Error('a pod principal must never reach the thread-family check')
          },
        }),
        extra: [ProbeRouter, PodLeasesRouter, { provide: PodLeasesService, useValue: leases }],
      }),
    )
  })

  afterEach(() => app.close())

  it("leases an access token for its own user's connection with no sandbox row or assignment", async () => {
    expect((await upload('session-a')).status).toBe(200)
    expect(store.sandboxes.size).toBe(0)
    expect(store.assignments.size).toBe(0)

    const issued = await mint('pod-token-a')

    expect(issued.status).toBe(200)
    expect(issued.headers['cache-control']).toBe('no-store')
    expect(issued.body.result.data).toMatchObject({ accessToken: 'access-0', generation: 0 })
    expect(JSON.stringify(issued.body)).not.toContain('refresh-0')
  })

  it("cannot lease another user's connection", async () => {
    expect((await upload('session-b')).status).toBe(200)

    expect((await mint('pod-token-a')).status).toBe(404)
  })

  it('is refused on a procedure that is not podReachable, threadless or not', async () => {
    const get = (procedure: string, input?: object) => {
      const call = request(app.getHttpServer()).get(`/v1/trpc/probe.${procedure}`)
      const withInput = input === undefined ? call : call.query({ input: JSON.stringify(input) })
      return withInput.set(as('pod-token-a'))
    }

    expect((await get('plain')).status).toBe(403)
    expect((await get('plainThread', { threadId: 'thread-pod-a' })).status).toBe(403)
    expect((await get('pod')).status).toBe(200)
  })

  it('is unauthorized on the session-only lease procedures and on connection management', async () => {
    const lease = (procedure: string, body: object) =>
      mutate({ app, procedure: `podLeases.${procedure}`, token: 'pod-token-a', body })

    expect((await lease('register', { threadId: 'thread-pod-a', token: 'x' })).status).toBe(401)
    expect((await lease('release', { threadId: 'thread-pod-a' })).status).toBe(401)
    expect((await upload('pod-token-a')).status).toBe(401)
    expect(leases.register).not.toHaveBeenCalled()
    expect(leases.release).not.toHaveBeenCalled()
  })
})
