import { describe, expect, it } from 'bun:test'

import { ENotifyMoment } from '@dltech/atlas-core'

import {
  ENotifyDeviceKind,
  type AtlasNotification,
  type NotificationTransport,
  type NotifyDevice,
  type NotifyResult,
} from '../index'

const notification: AtlasNotification = {
  sessionId: 'session-1',
  seq: 12,
  moment: ENotifyMoment.TurnFinished,
  title: 'Fix the renderer',
  body: 'Finished',
  at: '2026-11-23T14:02:00.000Z',
}

const device = (overrides: Partial<NotifyDevice> = {}): NotifyDevice => ({
  id: 'device-1',
  kind: ENotifyDeviceKind.WebPush,
  token: 'https://push.example/abc',
  secret: null,
  ...overrides,
})

describe('notify device kinds', () => {
  it('names the three transports', () => {
    expect(String(ENotifyDeviceKind.WebPush)).toBe('web-push')
    expect(String(ENotifyDeviceKind.Expo)).toBe('expo')
    expect(String(ENotifyDeviceKind.ApnsMac)).toBe('apns-mac')
  })
})

describe('NotificationTransport', () => {
  it('accepts a transport that delivers one result per device and clears by session', async () => {
    const transport: NotificationTransport = {
      kind: ENotifyDeviceKind.Expo,
      deliver: async (args) => args.devices.map((target) => ({ deviceId: target.id, sent: true })),
      clear: async (args) =>
        args.devices.map((target) => ({ deviceId: target.id, sent: true, gone: true })),
    }

    const delivered: readonly NotifyResult[] = await transport.deliver({
      devices: [device()],
      notification,
    })
    const cleared: readonly NotifyResult[] = await transport.clear({
      devices: [device()],
      sessionId: 'session-1',
    })

    expect(transport.kind).toBe(ENotifyDeviceKind.Expo)
    expect(delivered).toEqual([{ deviceId: 'device-1', sent: true }])
    expect(cleared).toEqual([{ deviceId: 'device-1', sent: true, gone: true }])
  })
})
