import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ensureTestDatabase } from '@dltech/atlas-db/testing'
import type { AddressInfo } from 'node:net'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const WEB_ORIGIN = 'http://localhost:3001'

const applyHostEnv = (): void => {
  process.env.DATABASE_DIRECT_URL = process.env.DATABASE_URL
  process.env.REDIS_URL = REDIS_URL
  process.env.RATE_LIMIT_PER_MINUTE = '6000'
  process.env.DAEMON_SECRET = 'test-daemon-secret'
  process.env.ATLAS_API_ORIGIN = 'https://api.byatlas.io'
  process.env.TRUSTED_ORIGINS = WEB_ORIGIN
}

type Booted = { app: NestExpressApplication; base: string }

const boot = async (): Promise<Booted> => {
  const { createApp } = await import('../src/create-app')
  const app = await createApp({ withHost: true })
  await app.listen(0)
  const address = app.getHttpServer().address() as AddressInfo
  return { app, base: `http://127.0.0.1:${address.port}` }
}

const describeWithHost = REDIS_URL === undefined ? describe.skip : describe

describeWithHost('api and agent host in one process', () => {
  let booted: Booted

  beforeAll(async () => {
    await ensureTestDatabase()
    applyHostEnv()
    booted = await boot()
  }, 180_000)

  afterAll(async () => {
    await booted.app.close()
  })

  it('serves the versioned api health route', async () => {
    const response = await fetch(`${booted.base}/v1/health`)
    const body = (await response.json()) as { status?: string; service?: string; message?: string }

    expect([200, 503]).toContain(response.status)
    if (response.status === 200) expect(body).toMatchObject({ status: 'ok', service: 'api' })
    else expect(body.message).toContain('migration')
  })

  it('keeps tRPC mounted under /v1/trpc', async () => {
    const response = await fetch(`${booted.base}/v1/trpc/models.list?input=%7B%7D`)

    expect(response.status).toBe(401)
  })

  it('serves the unversioned host health route', async () => {
    const health = await fetch(`${booted.base}/healthz`)
    const versioned = await fetch(`${booted.base}/v1/healthz`)

    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })
    expect(versioned.status).toBe(404)
  })

  it('answers the operator answer preflight on the api cors allowlist', async () => {
    const response = await fetch(`${booted.base}/operator-requests/answer`, {
      method: 'OPTIONS',
      headers: {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    })

    expect(response.status).toBeLessThan(300)
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN)
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('refuses a plain GET on the stream route', async () => {
    const response = await fetch(`${booted.base}/stream`)

    expect(response.status).toBe(426)
  })

  it('accepts the stream websocket upgrade', async () => {
    const opened = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`${booted.base.replace('http', 'ws')}/stream`)
      const settle = (accepted: boolean): void => {
        socket.close()
        resolve(accepted)
      }
      socket.addEventListener('open', () => settle(true))
      socket.addEventListener('error', () => settle(false))
    })

    expect(opened).toBe(true)
  })
})
