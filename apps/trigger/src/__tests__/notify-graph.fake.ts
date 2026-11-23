import type { AtlasNotification, NotifyPresence, SettingScalar } from '@dltech/atlas-core'
import {
  ENotifyDeviceKind,
  type NotifyDevice,
  type NotifyResult,
} from '@dltech/atlas-notifications'
import { ProductAnalytics } from '@dltech/atlas-observability'
import type { NotifyGraph, NotifySessionRow } from '../trigger/notify/notify-send-graph'

export type CapturedEvent = {
  userId: string
  event: string
  properties: Record<string, unknown>
}

export class RecordingAnalytics extends ProductAnalytics {
  constructor(readonly captured: CapturedEvent[] = []) {
    super()
  }

  capture(args: { userId: string; event: string; properties?: Record<string, unknown> }): void {
    this.captured.push({
      userId: args.userId,
      event: args.event,
      properties: args.properties ?? {},
    })
  }

  async flush(): Promise<void> {}
}

export type NotifyGraphRecord = {
  delivered: {
    kind: ENotifyDeviceKind
    devices: readonly NotifyDevice[]
    notification: AtlasNotification
    at: string
  }[]
  removed: string[]
  touched: { deviceId: string; now: string }[]
  soundClaims: string[]
  supersededChecks: { threadId: string; seq: number }[]
  captured: CapturedEvent[]
}

export const deviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice => ({
  id: 'device-1',
  kind: ENotifyDeviceKind.WebPush,
  token: 'https://push.example/endpoint-1',
  secret: JSON.stringify({ p256dh: 'key-1', auth: 'auth-1' }),
  ...overrides,
})

export const expoDeviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice =>
  deviceOf({
    id: 'expo-1',
    kind: ENotifyDeviceKind.Expo,
    token: 'ExponentPushToken[t]',
    secret: null,
    ...overrides,
  })

export const apnsDeviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice =>
  deviceOf({
    id: 'mac-1',
    kind: ENotifyDeviceKind.ApnsMac,
    token: 'b'.repeat(64),
    secret: null,
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
  nested: false,
  spawnedBySessionId: null,
  mainThreadId: 'thread-1',
  ...overrides,
})

const resultsOf = (args: {
  targets: readonly NotifyDevice[]
  results: readonly NotifyResult[] | undefined
}): readonly NotifyResult[] =>
  args.results === undefined
    ? args.targets.map((device) => ({ deviceId: device.id, sent: true }))
    : args.results.filter((result) => args.targets.some((device) => device.id === result.deviceId))

export const notifyGraphOf = (
  args: {
    session?: NotifySessionRow | null
    presence?: readonly NotifyPresence[]
    devices?: readonly NotifyDevice[]
    settings?: ReadonlyMap<string, SettingScalar>
    results?: readonly NotifyResult[]
    now?: string
    superseded?: boolean
    sound?: boolean
    record?: NotifyGraphRecord
    analytics?: ProductAnalytics
  } = {},
): { graph: NotifyGraph; record: NotifyGraphRecord } => {
  const record = args.record ?? {
    delivered: [],
    removed: [],
    touched: [],
    soundClaims: [],
    supersededChecks: [],
    captured: [],
  }
  const analytics = args.analytics ?? new RecordingAnalytics(record.captured)
  const now = args.now ?? '2026-11-23T14:02:00.000Z'
  const devices = args.devices ?? [deviceOf()]

  const transportOf = (kind: ENotifyDeviceKind) => ({
    kind,
    deliver: async ({
      devices: targets,
      notification,
    }: {
      devices: readonly NotifyDevice[]
      notification: AtlasNotification
    }) => {
      record.delivered.push({ kind, devices: targets, notification, at: now })
      return resultsOf({ targets, results: args.results })
    },
    clear: async ({ devices: targets }: { devices: readonly NotifyDevice[] }) =>
      targets.map((device) => ({ deviceId: device.id, sent: true })),
  })

  return {
    record,
    graph: {
      session: {
        read: async () => (args.session === undefined ? sessionOf() : args.session),
      },
      turns: {
        startedAfter: async (check) => {
          record.supersededChecks.push(check)
          return args.superseded === true
        },
      },
      sound: {
        claim: async (claim) => {
          record.soundClaims.push(claim.userId)
          return args.sound ?? true
        },
      },
      devices: {
        listEnabled: async () => [...devices],
        touch: async (touch) => {
          record.touched.push(touch)
        },
        remove: async (remove) => {
          record.removed.push(remove.deviceId)
        },
      },
      presence: { read: async () => [...(args.presence ?? [])] },
      settings: { read: async () => new Map(args.settings ?? []) },
      analytics,
      transports: {
        [ENotifyDeviceKind.WebPush]: transportOf(ENotifyDeviceKind.WebPush),
        [ENotifyDeviceKind.Expo]: transportOf(ENotifyDeviceKind.Expo),
        [ENotifyDeviceKind.ApnsMac]: transportOf(ENotifyDeviceKind.ApnsMac),
      },
      now: () => now,
      dispose: async () => undefined,
    },
  }
}
