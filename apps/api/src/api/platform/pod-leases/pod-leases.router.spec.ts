import { ConflictException } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createPodLeasesApp, leases } from './pod-leases.router.fixture'

describe('PodLeasesRouter', () => {
  let app: NestExpressApplication

  const call = (args: { procedure: string; token?: string; body: object }) => {
    const sent = request(app.getHttpServer()).post(`/v1/trpc/podLeases.${args.procedure}`)
    return (args.token === undefined ? sent : sent.set(as(args.token))).send(args.body)
  }
  const register = (body: object, token?: string) =>
    call({ procedure: 'register', ...(token === undefined ? {} : { token }), body })
  const registerAsSession = (body: object) => register(body, 'session-a')

  beforeEach(async () => {
    leases.register.mockReset().mockResolvedValue(undefined)
    leases.release.mockReset().mockResolvedValue(undefined)
    app = await createPodLeasesApp()
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller on both procedures', async () => {
    expect((await register({ threadId: 'brn_1', token: 'x' })).status).toBe(401)
    expect((await call({ procedure: 'release', body: { threadId: 'brn_1' } })).status).toBe(401)
    expect(leases.register).not.toHaveBeenCalled()
    expect(leases.release).not.toHaveBeenCalled()
  })

  it('registers the lease for the session user', async () => {
    const response = await registerAsSession({ threadId: 'brn_1', token: 'raw' })

    expect(response.status).toBe(200)
    expect(leases.register).toHaveBeenCalledWith({
      userId: 'user-a',
      threadId: 'brn_1',
      token: 'raw',
    })
  })

  it('validates the input', async () => {
    const put = (body: object) => registerAsSession({ threadId: 'brn_1', ...body })

    expect((await put({})).status).toBe(400)
    expect((await put({ token: '' })).status).toBe(400)
    expect((await put({ token: 5 })).status).toBe(400)
    expect((await put({ token: 'x'.repeat(513) })).status).toBe(400)
    expect((await put({ token: 'x', extra: 1 })).status).toBe(400)
    expect((await registerAsSession({ token: 'x' })).status).toBe(400)
    expect((await put({ token: 'x'.repeat(512) })).status).toBe(200)
    expect(leases.register).toHaveBeenCalledTimes(1)
  })

  it('surfaces a foreign token hash as 409', async () => {
    leases.register.mockRejectedValue(new ConflictException('taken'))

    expect((await registerAsSession({ threadId: 'brn_1', token: 'raw' })).status).toBe(409)
  })

  it('releases for the session user', async () => {
    const response = await call({
      procedure: 'release',
      token: 'session-a',
      body: { threadId: 'brn_1' },
    })

    expect(response.status).toBe(200)
    expect(leases.release).toHaveBeenCalledWith({ userId: 'user-a', threadId: 'brn_1' })
  })
})
