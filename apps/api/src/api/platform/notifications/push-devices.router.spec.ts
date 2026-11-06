import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { seedUsers } from '../../../../test/session-seed'
import { NotificationsService } from './notifications.service'
import { PushDevicesRouter } from './push-devices.router'

const TOKEN = 'ExponentPushToken[abc123]'
const OTHER_TOKEN = 'ExponentPushToken[def456]'

const notifications = {
  notifyUser: vi.fn(async (_args: { userId: string; title: string; body: string }) => undefined),
}

const devicesOf = async (userId: string) =>
  db.orm.public.PushDevice.where({ userId })
    .orderBy((device) => device.token.asc())
    .all()

describe('PushDevicesRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    notifications.notifyUser.mockClear()
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        PushDevicesRouter,
        SessionMiddleware,
        { provide: NotificationsService, useValue: notifications },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId =
                req.headers.authorization === 'Bearer s1'
                  ? 'usr-1'
                  : req.headers.authorization === 'Bearer s2'
                    ? 'usr-2'
                    : null
              return userId === null ? null : { userId, sessionId: `auth-${userId}`, email: '' }
            },
          },
        },
      ],
    })
  })
  afterEach(() => app.close())

  it('registers a device for the caller', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: TOKEN, platform: 'ios' })
    expect(reply.status).toBe(200)
    const rows = await devicesOf('usr-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).toBe(TOKEN)
    expect(rows[0]?.platform).toBe('ios')
    expect(rows[0]?.lastSeenAt).toBeInstanceOf(Date)
  })

  it('stores the auth session that registered the device', async () => {
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: TOKEN, platform: 'ios' })
    expect((await devicesOf('usr-1'))[0]?.authSessionId).toBe('auth-usr-1')
  })

  it('links a re-registered token to the new caller session', async () => {
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: TOKEN, platform: 'ios' })
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s2'))
      .send({ token: TOKEN, platform: 'ios' })
    expect((await devicesOf('usr-2'))[0]?.authSessionId).toBe('auth-usr-2')
  })

  it('reassigns the token when a second caller registers it', async () => {
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: TOKEN, platform: 'ios' })
    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s2'))
      .send({ token: TOKEN, platform: 'android' })
    expect(reply.status).toBe(200)
    expect(await devicesOf('usr-1')).toHaveLength(0)
    const rows = await devicesOf('usr-2')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.platform).toBe('android')
  })

  it('rejects a malformed token', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: 'not-a-token', platform: 'ios' })
    expect(reply.status).toBe(400)
  })

  it('unregisters only the caller own row', async () => {
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: TOKEN, platform: 'ios' })
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s2'))
      .send({ token: OTHER_TOKEN, platform: 'ios' })

    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.unregister')
      .set(as('s1'))
      .send({ token: TOKEN })
    expect(reply.status).toBe(200)
    expect(await devicesOf('usr-1')).toHaveLength(0)
    expect(await devicesOf('usr-2')).toHaveLength(1)
  })

  it('sends a test push to every caller device and reports the count', async () => {
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: TOKEN, platform: 'ios' })
    await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .set(as('s1'))
      .send({ token: OTHER_TOKEN, platform: 'ios' })

    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.sendTest')
      .set(as('s1'))
      .send({})
    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({ devices: 2 })
    expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
    expect(notifications.notifyUser.mock.calls[0]?.[0]).toMatchObject({
      userId: 'usr-1',
      title: 'Atlas',
      body: 'Test notification',
    })
  })

  it('answers 401 without a session', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/trpc/pushDevices.register')
      .send({ token: TOKEN, platform: 'ios' })
    expect(reply.status).toBe(401)
  })
})
