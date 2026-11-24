import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  ENotifyDeviceKind,
  type NotificationTransport,
  type NotifyResult,
} from '@dltech/atlas-notifications'
import { webPushTransport } from '@dltech/atlas-notifications/server'
import { triggerSdkFake } from './trigger-sdk.fake'
import { apnsDeviceOf, deviceOf, expoDeviceOf, notifyGraphOf } from './notify-graph.fake'
import type { NotifyGraph } from '../notify/notify-send-graph'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { runNotifyClear } = await import('../notify/notify-clear.task')

const PAYLOAD = { userId: 'usr-1', sessionId: 'session-1' }

const VAPID = {
  publicKey: 'public-key',
  privateKey: 'private-key',
  subject: 'mailto:atlas@byatlas.io',
}

type ClearCall = {
  kind: ENotifyDeviceKind
  sessionId: string
  deviceIds: readonly string[]
}

let clears: ClearCall[] = []

beforeEach(() => {
  clears = []
})

const recorderOf = (
  kind: ENotifyDeviceKind,
  results?: readonly NotifyResult[],
): NotificationTransport => ({
  kind,
  deliver: async () => [],
  clear: async ({ devices, sessionId }) => {
    clears.push({ kind, sessionId, deviceIds: devices.map((device) => device.id) })
    return results === undefined
      ? devices.map((device) => ({ deviceId: device.id, sent: true }))
      : [...results]
  },
})

const graphWith = (transports: NotifyGraph['transports']): NotifyGraph => {
  const base = notifyGraphOf({
    devices: [
      deviceOf(),
      expoDeviceOf({ id: 'device-2', token: 'ExponentPushToken[token-2]' }),
      apnsDeviceOf({ id: 'mac-1' }),
    ],
  })
  return { ...base.graph, transports }
}

describe('runNotifyClear', () => {
  it('clears every enabled device of every kind', async () => {
    const graph = graphWith({
      [ENotifyDeviceKind.WebPush]: recorderOf(ENotifyDeviceKind.WebPush),
      [ENotifyDeviceKind.Expo]: recorderOf(ENotifyDeviceKind.Expo),
      [ENotifyDeviceKind.ApnsMac]: recorderOf(ENotifyDeviceKind.ApnsMac),
    })

    expect(await runNotifyClear({ graph, payload: PAYLOAD })).toEqual({ sent: 3, gone: 0 })
    expect(clears).toEqual([
      { kind: ENotifyDeviceKind.WebPush, sessionId: 'session-1', deviceIds: ['device-1'] },
      { kind: ENotifyDeviceKind.Expo, sessionId: 'session-1', deviceIds: ['device-2'] },
      { kind: ENotifyDeviceKind.ApnsMac, sessionId: 'session-1', deviceIds: ['mac-1'] },
    ])
  })

  it('clears nothing when the user has no device', async () => {
    const base = notifyGraphOf({ devices: [] })

    expect(await runNotifyClear({ graph: base.graph, payload: PAYLOAD })).toEqual({
      sent: 0,
      gone: 0,
    })
    expect(clears).toEqual([])
  })

  it('skips an Apple web push endpoint and pushes to the others', async () => {
    const sent: string[] = []
    const base = notifyGraphOf({
      devices: [
        deviceOf({ token: 'https://web.push.apple.com/sub-1' }),
        deviceOf({ id: 'device-2', token: 'https://push.example/endpoint-2' }),
      ],
    })
    const graph: NotifyGraph = {
      ...base.graph,
      transports: {
        [ENotifyDeviceKind.WebPush]: webPushTransport({
          vapid: VAPID,
          send: async ({ subscription }) => {
            sent.push(subscription.endpoint)
            return { statusCode: 201 }
          },
        }),
      },
    }

    expect(await runNotifyClear({ graph, payload: PAYLOAD })).toEqual({ sent: 1, gone: 0 })
    expect(sent).toEqual(['https://push.example/endpoint-2'])
  })

  it('prunes a device a transport reports gone', async () => {
    const base = notifyGraphOf({
      devices: [deviceOf(), deviceOf({ id: 'device-2', token: 'https://push.example/dead' })],
    })
    const graph: NotifyGraph = {
      ...base.graph,
      transports: {
        [ENotifyDeviceKind.WebPush]: recorderOf(ENotifyDeviceKind.WebPush, [
          { deviceId: 'device-1', sent: true },
          { deviceId: 'device-2', sent: false, gone: true },
        ]),
      },
    }

    expect(await runNotifyClear({ graph, payload: PAYLOAD })).toEqual({ sent: 1, gone: 1 })
    expect(base.record.removed).toEqual(['device-2'])
  })
})
