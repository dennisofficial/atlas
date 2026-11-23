import { describe, expect, it } from 'bun:test'
import { ENotifyMoment, type AtlasNotification } from '@dltech/atlas-core'
import { ENotifyDeviceKind, type NotifyDevice } from '../model'
import {
  WEB_PUSH_TTL_S,
  webPushTopicOf,
  webPushTransport,
  type WebPushSendOptions,
  type WebPushSubscription,
} from '../transports/web-push'

const VAPID = { publicKey: 'public', privateKey: 'private', subject: 'https://byatlas.io' }

const NOTIFICATION: AtlasNotification = {
  sessionId: 'session-1',
  seq: 7,
  moment: ENotifyMoment.TurnFinished,
  title: 'Fix the parser',
  body: 'The turn finished.',
  at: '2026-11-23T14:02:00.000Z',
}

const deviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice => ({
  id: 'device-1',
  kind: ENotifyDeviceKind.WebPush,
  token: 'https://push.example/endpoint-1',
  secret: JSON.stringify({ p256dh: 'key-1', auth: 'auth-1' }),
  ...overrides,
})

type Send = {
  subscription: WebPushSubscription
  payload: string
  options: WebPushSendOptions
}

const recorderOf = (reply?: () => Promise<{ statusCode: number }>) => {
  const sent: Send[] = []
  const send = async (args: Send): Promise<{ statusCode: number }> => {
    sent.push(args)
    return reply === undefined ? { statusCode: 201 } : reply()
  }
  return { sent, send }
}

const refusalOf = (statusCode: number) => () =>
  Promise.reject(Object.assign(new Error(`push refused ${statusCode}`), { statusCode }))

describe('webPushTransport.deliver', () => {
  it('signs and posts the notification with a one-day TTL and a stable topic', async () => {
    const recorder = recorderOf()
    const transport = webPushTransport({ vapid: VAPID, send: recorder.send })

    await transport.deliver({ devices: [deviceOf()], notification: NOTIFICATION })

    expect(recorder.sent).toHaveLength(1)
    expect(recorder.sent[0]?.subscription).toEqual({
      endpoint: 'https://push.example/endpoint-1',
      keys: { p256dh: 'key-1', auth: 'auth-1' },
    })
    expect(JSON.parse(recorder.sent[0]?.payload ?? '{}')).toEqual({
      type: 'notification',
      notification: NOTIFICATION,
    })
    expect(recorder.sent[0]?.options.TTL).toBe(WEB_PUSH_TTL_S)
    expect(recorder.sent[0]?.options.vapidDetails).toEqual(VAPID)
    expect(recorder.sent[0]?.options.topic).toBe(webPushTopicOf('session-1'))
  })

  it('carries the moment and the send time so the worker can report without a lookup', async () => {
    const recorder = recorderOf()
    const transport = webPushTransport({ vapid: VAPID, send: recorder.send })

    await transport.deliver({ devices: [deviceOf()], notification: NOTIFICATION })

    const payload = JSON.parse(recorder.sent[0]?.payload ?? '{}') as {
      notification: Record<string, unknown>
    }
    expect(payload.notification.moment).toBe(ENotifyMoment.TurnFinished)
    expect(payload.notification.at).toBe('2026-11-23T14:02:00.000Z')
  })

  it('gives two moments of one session the same topic and keeps it under 32 characters', () => {
    const topic = webPushTopicOf('session-1')

    expect(topic).toBe(webPushTopicOf('session-1'))
    expect(topic).toHaveLength(32)
    expect(topic).toMatch(/^[a-z0-9]+$/)
  })

  it('reports two devices sent and one gone when the second endpoint is dead', async () => {
    let calls = 0
    const transport = webPushTransport({
      vapid: VAPID,
      send: async () => {
        calls += 1
        if (calls === 2) return refusalOf(410)()
        return { statusCode: 201 }
      },
    })

    const results = await transport.deliver({
      devices: [deviceOf(), deviceOf({ id: 'device-2', token: 'https://push.example/dead' })],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([
      { deviceId: 'device-1', sent: true },
      { deviceId: 'device-2', sent: false, gone: true },
    ])
  })

  it('maps 404 to gone and another refusal to a plain failure', async () => {
    const missing = webPushTransport({ vapid: VAPID, send: refusalOf(404) })
    const broken = webPushTransport({ vapid: VAPID, send: refusalOf(500) })

    expect(await missing.deliver({ devices: [deviceOf()], notification: NOTIFICATION })).toEqual([
      { deviceId: 'device-1', sent: false, gone: true },
    ])
    expect(await broken.deliver({ devices: [deviceOf()], notification: NOTIFICATION })).toEqual([
      { deviceId: 'device-1', sent: false },
    ])
  })

  it('prunes a device whose secret carries no subscription keys', async () => {
    const recorder = recorderOf()
    const transport = webPushTransport({ vapid: VAPID, send: recorder.send })

    const results = await transport.deliver({
      devices: [deviceOf({ secret: 'not json' })],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([{ deviceId: 'device-1', sent: false, gone: true }])
    expect(recorder.sent).toEqual([])
  })
})

describe('webPushTransport.clear', () => {
  it('posts a clear message for the session', async () => {
    const recorder = recorderOf()
    const transport = webPushTransport({ vapid: VAPID, send: recorder.send })

    const results = await transport.clear({ devices: [deviceOf()], sessionId: 'session-1' })

    expect(results).toEqual([{ deviceId: 'device-1', sent: true }])
    expect(JSON.parse(recorder.sent[0]?.payload ?? '{}')).toEqual({
      type: 'clear',
      sessionId: 'session-1',
    })
    expect(recorder.sent[0]?.options.topic).toBeUndefined()
  })

  it('skips an Apple endpoint, which needs a visible notification', async () => {
    const recorder = recorderOf()
    const transport = webPushTransport({ vapid: VAPID, send: recorder.send })

    const results = await transport.clear({
      devices: [deviceOf({ token: 'https://web.push.apple.com/QGVsbG8' })],
      sessionId: 'session-1',
    })

    expect(results).toEqual([{ deviceId: 'device-1', sent: false }])
    expect(recorder.sent).toEqual([])
  })
})
