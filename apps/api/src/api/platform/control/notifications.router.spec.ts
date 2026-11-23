import {
  EClientSurface,
  ENotifyDeviceKind,
  ENotifyMoment,
  ENotifyTrackEvent,
} from '@dltech/atlas-core'
import { ProductAnalytics } from '@dltech/atlas-observability'
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
import { PRODUCT_ANALYTICS } from '../../../agent'
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

type Captured = { userId: string; event: string; properties: Record<string, unknown> }

class FakeAnalytics extends ProductAnalytics {
  captured: Captured[] = []

  fail = false

  capture(args: { userId: string; event: string; properties?: Record<string, unknown> }): void {
    if (this.fail) throw new Error('analytics is down')
    this.captured.push({
      userId: args.userId,
      event: args.event,
      properties: args.properties ?? {},
    })
  }

  async flush(): Promise<void> {}
}

const analytics = new FakeAnalytics()

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
    analytics.captured = []
    analytics.fail = false
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      envValues: { WEB_PUSH_PUBLIC_KEY },
      providers: [
        NotificationsRouter,
        { provide: PresenceRegistry, useValue: presence },
        { provide: NotifyDevicesService, useValue: devices },
        { provide: JobsProjectDispatcher, useValue: dispatcher },
        { provide: PRODUCT_ANALYTICS, useValue: analytics },
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

  const track = (args: { body: object; token?: string }) =>
    mutation({ procedure: 'track', ...args })

  const deliveredBody = {
    event: ENotifyTrackEvent.Delivered,
    sessionId: 'session-1',
    seq: 7,
    moment: ENotifyMoment.TurnFinished,
    deviceKind: ENotifyDeviceKind.WebPush,
    sentAt: '2026-11-23T14:02:00.000Z',
  }

  it('captures a delivered event for the caller with the send latency', async () => {
    const reply = await track({ token: 's1', body: deliveredBody })

    expect(reply.status).toBe(200)
    expect(analytics.captured).toHaveLength(1)
    expect(analytics.captured[0]).toMatchObject({
      userId: 'usr-1',
      event: 'notification_delivered',
      properties: {
        moment: ENotifyMoment.TurnFinished,
        device_kind: ENotifyDeviceKind.WebPush,
        session_id: 'session-1',
        seq: 7,
      },
    })
    expect(typeof analytics.captured[0]?.properties.after_send_ms).toBe('number')
  })

  it('captures opened and dismissed with the device that reported them', async () => {
    await track({
      token: 's1',
      body: {
        ...deliveredBody,
        event: ENotifyTrackEvent.Opened,
        deviceKind: ENotifyDeviceKind.Expo,
      },
    })
    await track({
      token: 's2',
      body: {
        ...deliveredBody,
        event: ENotifyTrackEvent.Dismissed,
        deviceKind: ENotifyDeviceKind.ApnsMac,
      },
    })

    expect(analytics.captured.map((entry) => entry.event)).toEqual([
      'notification_opened',
      'notification_dismissed',
    ])
    expect(analytics.captured.map((entry) => entry.properties.device_kind)).toEqual([
      ENotifyDeviceKind.Expo,
      ENotifyDeviceKind.ApnsMac,
    ])
    expect(analytics.captured[1]?.userId).toBe('usr-2')
  })

  it('captures an in-app notice shown on a client under notification_in_app', async () => {
    const reply = await track({
      token: 's1',
      body: {
        ...deliveredBody,
        event: ENotifyTrackEvent.InAppShown,
        deviceKind: 'in-app-web',
        sentAt: undefined,
      },
    })

    expect(reply.status).toBe(200)
    expect(analytics.captured[0]).toMatchObject({
      event: 'notification_in_app',
      properties: { source: 'client', device_kind: 'in-app-web' },
    })
    expect(analytics.captured[0]?.properties).not.toHaveProperty('after_send_ms')
  })

  it('omits the send latency when the device has no send time', async () => {
    await track({ token: 's1', body: { ...deliveredBody, sentAt: undefined } })

    expect(analytics.captured[0]?.properties).not.toHaveProperty('after_send_ms')
  })

  it('accepts the report when analytics throws', async () => {
    analytics.fail = true

    const reply = await track({ token: 's1', body: deliveredBody })

    expect(reply.status).toBe(200)
    expect(analytics.captured).toEqual([])
  })

  it('rejects an unknown event and an unknown device kind', async () => {
    const badEvent = await track({ token: 's1', body: { ...deliveredBody, event: 'bounced' } })
    const badKind = await track({ token: 's1', body: { ...deliveredBody, deviceKind: 'carrier' } })

    expect(badEvent.status).toBe(400)
    expect(badKind.status).toBe(400)
    expect(analytics.captured).toEqual([])
  })

  it('answers 401 without a session and refuses a batched report', async () => {
    const anonymous = await track({ body: deliveredBody })
    const batched = await mutation({
      procedure: 'track',
      token: 's1',
      batch: true,
      body: deliveredBody,
    })

    expect(anonymous.status).toBe(401)
    expect(batched.status).toBe(400)
    expect(analytics.captured).toEqual([])
  })
})
