import type { NotifyPresence } from '@dltech/atlas-core'
import {
  ENotifyDeviceKind,
  type NotifyDevice,
  type NotifyResult,
} from '@dltech/atlas-notifications'
import type { NotifyGraph, NotifySessionRow } from '../trigger/notify/notify-send-graph'

export type NotifyGraphRecord = {
  delivered: { devices: readonly NotifyDevice[]; at: string }[]
  removed: string[]
  touched: { deviceId: string; now: string }[]
}

export const deviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice => ({
  id: 'device-1',
  kind: ENotifyDeviceKind.WebPush,
  token: 'https://push.example/endpoint-1',
  secret: JSON.stringify({ p256dh: 'key-1', auth: 'auth-1' }),
  ...overrides,
})

export const presenceOf = (overrides: Partial<NotifyPresence> = {}): NotifyPresence => ({
  surface: 'desktop' as NotifyPresence['surface'],
  sessionId: 'session-1',
  foreground: true,
  at: '2026-11-23T14:01:30.000Z',
  ...overrides,
})

export const sessionOf = (overrides: Partial<NotifySessionRow> = {}): NotifySessionRow => ({
  userId: 'usr-1',
  title: 'Fix the parser',
  readSeq: null,
  ...overrides,
})

export const notifyGraphOf = (args: {
  session?: NotifySessionRow | null
  presence?: readonly NotifyPresence[]
  devices?: readonly NotifyDevice[]
  results?: readonly NotifyResult[]
  now?: string
  record?: NotifyGraphRecord
}): { graph: NotifyGraph; record: NotifyGraphRecord } => {
  const record = args.record ?? { delivered: [], removed: [], touched: [] }
  const now = args.now ?? '2026-11-23T14:02:00.000Z'
  const devices = args.devices ?? [deviceOf()]
  const asks: { userId: string; kind: ENotifyDeviceKind }[] = []

  return {
    record,
    graph: {
      session: {
        read: async () => (args.session === undefined ? sessionOf() : args.session),
      },
      devices: {
        listEnabled: async (ask) => {
          asks.push(ask)
          return [...devices]
        },
        touch: async (touch) => {
          record.touched.push(touch)
        },
        remove: async (remove) => {
          record.removed.push(remove.deviceId)
        },
      },
      presence: { read: async () => [...(args.presence ?? [])] },
      transport: {
        kind: ENotifyDeviceKind.WebPush,
        deliver: async ({ devices: targets }) => {
          record.delivered.push({ devices: targets, at: now })
          return args.results ?? targets.map((device) => ({ deviceId: device.id, sent: true }))
        },
        clear: async ({ devices: targets }) =>
          targets.map((device) => ({ deviceId: device.id, sent: true })),
      },
      now: () => now,
      dispose: async () => undefined,
    },
  }
}
