import { EClientSurface } from '@dltech/atlas-core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { PresenceReport } from './presence-registry'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { NotificationsRouter } from './notifications.router'
import { NotifyDevicesService } from './notify-devices.service'
import { PresenceRegistry } from './presence-registry'

const WEB_PUSH_PUBLIC_KEY = 'BPublicKeyForTheBrowser'

const NOW = '2026-11-23T14:02:00.000Z'

const reported: PresenceReport[] = []

const registered: unknown[] = []

const unregistered: unknown[] = []

const enabled: unknown[] = []

const dispatched: { taskId: string; payload: unknown; idempotencyKey: string }[] = []

const presence = {
  report: async (args: PresenceReport) => {
    reported.push(args)
  },
  read: async () => [],
}

const devices = {
  register: async (args: unknown) => {
    registered.push(args)
    return { id: 'device-1' }
  },
  unregister: async (args: unknown) => {
    unregistered.push(args)
  },
  list: async () => [
    { id: 'device-1', kind: 'web-push', label: 'Chrome', enabled: true, lastSeenAt: NOW },
  ],
  setEnabled: async (args: unknown) => {
    enabled.push(args)
  },
  enabledCount: async () => 2,
}

const dispatcher = {
  dispatch: async (args: { task: { id: string }; payload: unknown; idempotencyKey: string }) => {
    dispatched.push({
      taskId: args.task.id,
      payload: args.payload,
      idempotencyKey: args.idempotencyKey,
    })
    return { runId: 'run-1' }
  },
}

const verifier = {
  async verify(req: { headers: { authorization?: string } }) {
    const userId =
      req.headers.authorization === 'Bearer s1'
        ? 'usr-1'
        : req.headers.authorization === 'Bearer s2'
          ? 'usr-2'
          : null
    return userId === null ? null : { userId, sessionId: `auth-${userId}`, email: '' }
  },
}

describe('NotificationsRouter', () => {
  let app: NestExpressApplication

  beforeEach(async () => {
    reported.length = 0
    registered.length = 0
    unregistered.length = 0
    enabled.length = 0
    dispatched.length = 0
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      envValues: { WEB_PUSH_PUBLIC_KEY },
      providers: [
        NotificationsRouter,
        { provide: PresenceRegistry, useValue: presence },
        { provide: NotifyDevicesService, useValue: devices },
        { provide: JobsProjectDispatcher, useValue: dispatcher },
        SessionMiddleware,
        { provide: SESSION_VERIFIER, useValue: verifier },
      ],
    })
  })
  afterEach(() => app.close())

  const mutation = (args: { procedure: string; body: object; token?: string; batch?: boolean }) =>
    request(app.getHttpServer())
      .post(`/v1/trpc/notifications.${args.procedure}`)
      .set(args.token === undefined ? {} : as(args.token))
      .query(args.batch === true ? { batch: '1' } : {})
      .send(args.body)

  const query = (args: { procedure: string; token?: string }) =>
    request(app.getHttpServer())
      .get(`/v1/trpc/notifications.${args.procedure}`)
      .query({ input: '{}' })
      .set(args.token === undefined ? {} : as(args.token))

  const reportPresence = (args: { body: object; token?: string; batch?: boolean }) =>
    mutation({ procedure: 'reportPresence', ...args })

  it('reports the presence of the caller', async () => {
    const reply = await reportPresence({
      token: 's1',
      body: { clientId: 'client-a', surface: 'desktop', sessionId: 'session-1', foreground: true },
    })

    expect(reply.status).toBe(200)
    expect(reported).toEqual([
      {
        userId: 'usr-1',
        clientId: 'client-a',
        surface: EClientSurface.Desktop,
        sessionId: 'session-1',
        foreground: true,
      },
    ])
  })

  it('takes the user from the session, never from the input', async () => {
    const reply = await reportPresence({
      token: 's2',
      body: {
        clientId: 'client-a',
        surface: 'ios',
        sessionId: null,
        foreground: false,
        userId: 'usr-1',
      },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('refuses a batched call', async () => {
    const reply = await reportPresence({
      token: 's1',
      batch: true,
      body: { clientId: 'client-a', surface: 'web', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('rejects an empty client id', async () => {
    const reply = await reportPresence({
      token: 's1',
      body: { clientId: '', surface: 'web', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('rejects an unknown surface', async () => {
    const reply = await reportPresence({
      token: 's1',
      body: { clientId: 'client-a', surface: 'tui', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(400)
    expect(reported).toEqual([])
  })

  it('answers 401 without a session', async () => {
    const reply = await reportPresence({
      body: { clientId: 'client-a', surface: 'web', sessionId: null, foreground: true },
    })

    expect(reply.status).toBe(401)
    expect(reported).toEqual([])
  })

  it('registers a device for the caller', async () => {
    const reply = await mutation({
      procedure: 'registerDevice',
      token: 's1',
      body: {
        kind: 'web-push',
        clientId: 'client-a',
        token: 'https://push.example/endpoint-1',
        secret: '{"p256dh":"key-1","auth":"auth-1"}',
        label: 'Chrome',
      },
    })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { id: 'device-1' } } })
    expect(registered).toEqual([
      {
        userId: 'usr-1',
        input: {
          kind: 'web-push',
          clientId: 'client-a',
          token: 'https://push.example/endpoint-1',
          secret: '{"p256dh":"key-1","auth":"auth-1"}',
          label: 'Chrome',
        },
      },
    ])
  })

  it('rejects an unknown device kind', async () => {
    const reply = await mutation({
      procedure: 'registerDevice',
      token: 's1',
      body: {
        kind: 'carrier-pigeon',
        clientId: 'client-a',
        token: 'https://push.example/endpoint-1',
        secret: null,
        label: 'Chrome',
      },
    })

    expect(reply.status).toBe(400)
    expect(registered).toEqual([])
  })

  it('unregisters and disables a device of the caller', async () => {
    const removed = await mutation({
      procedure: 'unregisterDevice',
      token: 's1',
      body: { deviceId: 'device-1' },
    })
    const disabled = await mutation({
      procedure: 'setDeviceEnabled',
      token: 's2',
      body: { deviceId: 'device-1', enabled: false },
    })

    expect(removed.status).toBe(200)
    expect(disabled.status).toBe(200)
    expect(unregistered).toEqual([{ userId: 'usr-1', input: { deviceId: 'device-1' } }])
    expect(enabled).toEqual([{ userId: 'usr-2', input: { deviceId: 'device-1', enabled: false } }])
  })

  it('lists the devices of the caller', async () => {
    const reply = await query({ procedure: 'listDevices', token: 's1' })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({
      devices: [
        { id: 'device-1', kind: 'web-push', label: 'Chrome', enabled: true, lastSeenAt: NOW },
      ],
    })
  })

  it('answers the public VAPID key', async () => {
    const reply = await query({ procedure: 'webPushKey', token: 's1' })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { publicKey: WEB_PUSH_PUBLIC_KEY } } })
  })

  it('dispatches one test notification for the caller', async () => {
    const reply = await mutation({ procedure: 'sendTest', token: 's1', body: {} })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { devices: 2 } } })
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.taskId).toBe('notify-test')
    expect(dispatched[0]?.payload).toEqual({ userId: 'usr-1' })
    expect(dispatched[0]?.idempotencyKey).toMatch(/^notify-test:usr-1:\d+$/)
  })
})
