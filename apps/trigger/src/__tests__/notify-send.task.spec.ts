import { describe, expect, it, mock } from 'bun:test'
import { ENotifyMoment, EPendingWork } from '@dltech/atlas-core'
import { ENotifyDeviceKind } from '@dltech/atlas-notifications'
import { ProductAnalytics } from '@dltech/atlas-observability'
import { triggerSdkFake } from './trigger-sdk.fake'
import {
  apnsDeviceOf,
  deviceOf,
  expoDeviceOf,
  notifyGraphOf,
  presenceOf,
  sessionOf,
} from './notify-graph.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { runNotifySend } = await import('../notify/notify-send.task')
const { runNotifyTest, testNotificationOf } = await import('../notify/notify-test.task')

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

  it('sends nothing when a newer turn started after the held one', async () => {
    const { graph, record } = notifyGraphOf({ superseded: true })

    expect(await runNotifySend({ graph, payload: { ...PAYLOAD, holdMs: 3_600_000 } })).toEqual({
      sent: 0,
      gone: 0,
    })
    expect(record.delivered).toEqual([])
    expect(record.supersededChecks).toEqual([{ threadId: 'thread-1', seq: 7 }])
  })

  it('reads no turn when the pushed moment was not held', async () => {
    const { graph, record } = notifyGraphOf()

    await runNotifySend({ graph, payload: PAYLOAD })

    expect(record.supersededChecks).toEqual([])
    expect(record.delivered).toHaveLength(1)
  })

  it('sends nothing when a nested session finished a turn no operator started', async () => {
    const { graph, record } = notifyGraphOf({
      session: sessionOf({ nested: true, spawnedBySessionId: 'session-0' }),
    })

    expect(await runNotifySend({ graph, payload: { ...PAYLOAD, operatorTurn: false } })).toEqual({
      sent: 0,
      gone: 0,
    })
    expect(record.delivered).toEqual([])
  })

  it('sends the finished notice of a nested session when the operator started the turn', async () => {
    const { graph, record } = notifyGraphOf({
      session: sessionOf({ nested: true, spawnedBySessionId: 'session-0' }),
    })

    expect(await runNotifySend({ graph, payload: { ...PAYLOAD, operatorTurn: true } })).toEqual({
      sent: 1,
      gone: 0,
    })
    expect(record.delivered[0]?.notification.silent).toBeUndefined()
  })

  it('sends the same notification silently when another push just sounded', async () => {
    const { graph, record } = notifyGraphOf({ sound: false })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 1, gone: 0 })
    expect(record.delivered[0]?.notification.silent).toBe(true)
    expect(record.soundClaims).toEqual(['usr-1'])
  })

  it('claims no sound slot when the plan sends nothing', async () => {
    const { graph, record } = notifyGraphOf({ session: sessionOf({ readSeq: 7 }) })

    await runNotifySend({ graph, payload: PAYLOAD })

    expect(record.soundClaims).toEqual([])
  })

  it('sends nothing when the session is already read', async () => {
    const { graph, record } = notifyGraphOf({
      session: sessionOf({ title: 'Fix', readSeq: 7 }),
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing when the user has no device', async () => {
    const { graph, record } = notifyGraphOf({ devices: [] })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing when the user turned this moment off', async () => {
    const { graph, record } = notifyGraphOf({
      settings: new Map([['web.notifications.event.finished.push', false]]),
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    expect(record.delivered).toEqual([])
  })

  it('sends nothing inside the quiet hours of the stored zone', async () => {
    const { graph, record } = notifyGraphOf({
      now: '2026-11-23T23:30:00.000Z',
      settings: new Map<string, string | boolean>([
        ['web.notifications.quietHours', true],
        ['web.notifications.quietFrom', '22:00'],
        ['web.notifications.quietTo', '07:00'],
        ['web.notifications.timezone', 'Europe/Berlin'],
      ]),
    })

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

  it('sends the mac device through the apns transport of its own kind', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [expoDeviceOf({ id: 'device-2' }), apnsDeviceOf()],
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 2, gone: 0 })
    expect(record.delivered.map((delivery) => delivery.kind)).toEqual([
      ENotifyDeviceKind.Expo,
      ENotifyDeviceKind.ApnsMac,
    ])
    expect(record.delivered[1]?.devices.map((device) => device.id)).toEqual(['mac-1'])
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

class ThrowingAnalytics extends ProductAnalytics {
  capture(): void {
    throw new Error('posthog is down')
  }

  async flush(): Promise<void> {}
}

describe('notify analytics', () => {
  it('captures the moment once per run with the decision the host took', async () => {
    const { graph, record } = notifyGraphOf()

    await runNotifySend({
      graph,
      payload: {
        ...PAYLOAD,
        holdMs: 3_600_000,
        pending: [EPendingWork.Shell],
        operatorTurn: true,
        endedAt: '2026-11-23T14:00:00.000Z',
      },
    })

    const moments = record.captured.filter((entry) => entry.event === 'notification_moment')
    expect(moments).toHaveLength(1)
    expect(moments[0]).toEqual({
      userId: 'usr-1',
      event: 'notification_moment',
      properties: {
        moment: ENotifyMoment.TurnFinished,
        session_id: 'session-1',
        seq: 7,
        verdict: 'hold',
        hold_ms: 3_600_000,
        pending_kinds: [EPendingWork.Shell],
        operator_turn: true,
        ended_at: '2026-11-23T14:00:00.000Z',
      },
    })
  })

  it('captures the moment of a turn that was not held as send', async () => {
    const { graph, record } = notifyGraphOf()

    await runNotifySend({ graph, payload: PAYLOAD })

    expect(record.captured[0]?.properties).toMatchObject({
      verdict: 'send',
      hold_ms: 0,
      pending_kinds: [],
      operator_turn: true,
    })
    expect(record.captured[0]?.properties).not.toHaveProperty('ended_at')
  })

  it('captures the reason a moment was read already', async () => {
    const { graph, record } = notifyGraphOf({ session: sessionOf({ readSeq: 7 }) })

    await runNotifySend({ graph, payload: PAYLOAD })

    const skipped = record.captured.filter((entry) => entry.event === 'notification_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.properties).toEqual({
      moment: ENotifyMoment.TurnFinished,
      session_id: 'session-1',
      seq: 7,
      reason: 'already-read',
      held: false,
      nested: false,
    })
  })

  it('captures a nested agent turn that no operator started as skipped', async () => {
    const { graph, record } = notifyGraphOf({
      session: sessionOf({ nested: true, spawnedBySessionId: 'session-0' }),
    })

    await runNotifySend({ graph, payload: { ...PAYLOAD, operatorTurn: false } })

    expect(record.captured.at(-1)?.properties).toMatchObject({
      reason: 'nested-agent-turn',
      nested: true,
    })
  })

  it('captures a held moment that a newer turn superseded as skipped and held', async () => {
    const { graph, record } = notifyGraphOf({ superseded: true })

    await runNotifySend({ graph, payload: { ...PAYLOAD, holdMs: 3_600_000 } })

    expect(record.captured.at(-1)?.event).toBe('notification_skipped')
    expect(record.captured.at(-1)?.properties).toMatchObject({ reason: 'superseded', held: true })
  })

  it('captures one sent event per device with the kind, the sound and the latency', async () => {
    const { graph, record } = notifyGraphOf({
      devices: [deviceOf(), expoDeviceOf({ id: 'device-2' })],
    })

    await runNotifySend({
      graph,
      payload: { ...PAYLOAD, endedAt: '2026-11-23T14:00:00.000Z' },
    })

    const sent = record.captured.filter((entry) => entry.event === 'notification_sent')
    expect(sent).toHaveLength(2)
    expect(sent.map((entry) => entry.properties)).toEqual([
      {
        moment: ENotifyMoment.TurnFinished,
        session_id: 'session-1',
        seq: 7,
        device_kind: ENotifyDeviceKind.WebPush,
        accepted: true,
        gone: false,
        sound: true,
        held_ms: 0,
        latency_ms: 120_000,
      },
      {
        moment: ENotifyMoment.TurnFinished,
        session_id: 'session-1',
        seq: 7,
        device_kind: ENotifyDeviceKind.Expo,
        accepted: true,
        gone: false,
        sound: true,
        held_ms: 0,
        latency_ms: 120_000,
      },
    ])
  })

  it('captures a silent push as sound false', async () => {
    const { graph, record } = notifyGraphOf({ sound: false })

    await runNotifySend({ graph, payload: PAYLOAD })

    expect(record.captured.at(-1)?.properties).toMatchObject({ sound: false })
  })

  it('captures the in-app plan that the server decided', async () => {
    const { graph, record } = notifyGraphOf({
      presence: [presenceOf({ sessionId: 'session-2', foreground: true })],
    })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 0, gone: 0 })
    const inApp = record.captured.filter((entry) => entry.event === 'notification_in_app')
    expect(inApp).toHaveLength(1)
    expect(inApp[0]?.properties).toEqual({
      moment: ENotifyMoment.TurnFinished,
      session_id: 'session-1',
      seq: 7,
      source: 'server',
    })
  })

  it('still delivers when analytics throws', async () => {
    const { graph, record } = notifyGraphOf({ analytics: new ThrowingAnalytics() })

    expect(await runNotifySend({ graph, payload: PAYLOAD })).toEqual({ sent: 1, gone: 0 })
    expect(record.delivered).toHaveLength(1)
  })
})
