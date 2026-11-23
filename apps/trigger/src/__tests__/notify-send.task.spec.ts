import { describe, expect, it, mock } from 'bun:test'
import { ENotifyMoment } from '@dltech/atlas-core'
import { ENotifyDeviceKind } from '@dltech/atlas-notifications'
import { triggerSdkFake } from './trigger-sdk.fake'
import { deviceOf, expoDeviceOf, notifyGraphOf, presenceOf } from './notify-graph.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { runNotifySend } = await import('../trigger/notify/notify-send.task')
const { runNotifyTest, testNotificationOf } = await import('../trigger/notify/notify-test.task')

const PAYLOAD = {
  sessionId: 'session-1',
  threadId: 'thread-1',
  seq: 7,
  moment: ENotifyMoment.TurnFinished,
}

describe('runNotifySend', () => {
  it('sends nothing when the session is gone', async () => {
    const { graph, record } = notifyGraphOf({ session: null })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing while the session is on screen', async () => {
    const { graph, record } = notifyGraphOf({
      presence: [presenceOf({ sessionId: 'session-1', foreground: true })],
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing while another session is in front on an Atlas client', async () => {
    const { graph, record } = notifyGraphOf({
      presence: [presenceOf({ sessionId: 'session-2', foreground: true })],
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing when the session is already read', async () => {
    const { graph, record } = notifyGraphOf({
      session: { userId: 'usr-1', title: 'Fix', readSeq: 7 },
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing when the user has no device', async () => {
    const { graph, record } = notifyGraphOf({ devices: [] })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends one notification to every device when no client is in front', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), deviceOf({ id: 'device-2', token: 'https://push.example/endpoint-2' })],
      now: '2026-11-23T14:02:00.000Z',
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 2, gone: 0 })
    expect(record.delivered).toHaveLength(1)
    expect(record.delivered[0]?.devices.map((device) => device.id)).toEqual([
      'device-1',
      'device-2',
    ])
    expect(record.touched).toEqual([
      { deviceId: 'device-1', now: '2026-11-23T14:02:00.000Z' },
      { deviceId: 'device-2', now: '2026-11-23T14:02:00.000Z' },
    ])
  })

  it('sends one notification per kind to a web device and an expo device', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), expoDeviceOf({ id: 'device-2', token: 'ExponentPushToken[token-2]' })],
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 2, gone: 0 })
    expect(record.delivered.map((delivery) => delivery.kind)).toEqual([
      ENotifyDeviceKind.WebPush,
      ENotifyDeviceKind.Expo,
    ])
    expect(record.delivered.map((delivery) => delivery.devices.map((device) => device.id))).toEqual(
      [['device-1'], ['device-2']],
    )
  })

  it('prunes the device a transport reports gone', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), deviceOf({ id: 'device-2', token: 'https://push.example/dead' })],
      results: [
        { deviceId: 'device-1', sent: true },
        { deviceId: 'device-2', sent: false, gone: true },
      ],
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 1, gone: 1 })
    expect(record.removed).toEqual(['device-2'])
    expect(record.touched.map((touch) => touch.deviceId)).toEqual(['device-1'])
  })
})

describe('runNotifyTest', () => {
  it('sends a test notification to a web device and an expo device', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), expoDeviceOf({ id: 'device-2' })],
    })

    expect(await runNotifyTest({ graph, payload: { userId: 'usr-1' } })).toEqual({
      sent: 2,
      gone: 0,
    })
    expect(record.delivered.map((delivery) => delivery.kind)).toEqual([
      ENotifyDeviceKind.WebPush,
      ENotifyDeviceKind.Expo,
    ])
  })

  it('prunes an expo device whose token Expo no longer knows', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), expoDeviceOf({ id: 'device-2' })],
      results: [
        { deviceId: 'device-1', sent: true },
        { deviceId: 'device-2', sent: false, gone: true },
      ],
    })

    expect(await runNotifyTest({ graph, payload: { userId: 'usr-1' } })).toEqual({
      sent: 1,
      gone: 1,
    })
    expect(record.removed).toEqual(['device-2'])
  })

  it('sends a test notification to every enabled device of the user', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), deviceOf({ id: 'device-2', token: 'https://push.example/endpoint-2' })],
    })

    expect(await runNotifyTest({ graph, payload: { userId: 'usr-1' } })).toEqual({
      sent: 2,
      gone: 0,
    })
    expect(record.delivered[0]?.devices).toHaveLength(2)
  })

  it('sends nothing when the user has no device', async () => {
    const { graph, record } = notifyGraphOf({ devices: [] })

    expect(await runNotifyTest({ graph, payload: { userId: 'usr-1' } })).toEqual({
      sent: 0,
      gone: 0,
    })
    expect(record.delivered).toEqual([])
  })

  it('names the notification so the browser replaces any earlier one', () => {
    expect(testNotificationOf('2026-11-23T14:02:00.000Z')).toMatchObject({
      sessionId: 'notify-test',
      seq: 0,
      title: 'Atlas',
      body: 'Test notification',
    })
  })
})
