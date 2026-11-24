import Redis from 'ioredis'
import { and, db } from '@dltech/atlas-db'
import {
  ENotifyDeviceKind,
  type AtlasNotification,
  type NotificationTransport,
  type NotifyDevice,
  type NotifyResult,
} from '@dltech/atlas-notifications'
import { notifyDeviceKindSchema } from '@dltech/atlas-wire'
import {
  apnsTransport,
  expoTransport,
  readPresence,
  webPushTransport,
  type PresenceHash,
} from '@dltech/atlas-notifications/server'
import { decodeSettingValue, type NotifyPresence, type SettingScalar } from '@dltech/atlas-core'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { serverObservability } from '@dltech/atlas-observability/node'

export type NotifySessionRow = {
  userId: string
  title: string | null
  readSeq: number | null
  nested: boolean
  spawnedBySessionId: string | null
  mainThreadId: string
}

export type NotifyGraph = {
  session: { read(args: { sessionId: string }): Promise<NotifySessionRow | null> }
  turns: { startedAfter(args: { threadId: string; seq: number }): Promise<boolean> }
  sound: { claim(args: { userId: string }): Promise<boolean> }
  devices: {
    listEnabled(args: { userId: string }): Promise<NotifyDevice[]>
    touch(args: { deviceId: string; now: string }): Promise<void>
    remove(args: { deviceId: string }): Promise<void>
  }
  presence: { read(args: { userId: string; now: string }): Promise<NotifyPresence[]> }
  settings: { read(args: { userId: string }): Promise<ReadonlyMap<string, SettingScalar>> }
  analytics: ProductAnalytics
  transports: Partial<Record<ENotifyDeviceKind, NotificationTransport>>
  now(): string
  dispose(): Promise<void>
}

const vapidOf = (env: Record<string, string | undefined>) => {
  const publicKey = absent(env['WEB_PUSH_PUBLIC_KEY'])
  const privateKey = absent(env['WEB_PUSH_PRIVATE_KEY'])
  const subject = absent(env['WEB_PUSH_SUBJECT'])
  if (publicKey === undefined || privateKey === undefined || subject === undefined) return null
  return { publicKey, privateKey, subject }
}

const absent = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value

const apnsOf = (env: Record<string, string | undefined>) => {
  const keyP8 = absent(env['APNS_KEY_P8'])
  const keyId = absent(env['APNS_KEY_ID'])
  const teamId = absent(env['APNS_TEAM_ID'])
  const topic = absent(env['APNS_TOPIC'])
  if (keyP8 === undefined || keyId === undefined || teamId === undefined || topic === undefined)
    return null
  return { keyP8: keyP8.replaceAll('\\n', '\n'), keyId, teamId, topic }
}

export const transportsOf = (
  env: Record<string, string | undefined>,
): Partial<Record<ENotifyDeviceKind, NotificationTransport>> => {
  const vapid = vapidOf(env)
  const apns = apnsOf(env)
  return {
    [ENotifyDeviceKind.Expo]: expoTransport({ accessToken: absent(env['EXPO_ACCESS_TOKEN']) }),
    ...(vapid === null ? {} : { [ENotifyDeviceKind.WebPush]: webPushTransport({ vapid }) }),
    ...(apns === null ? {} : { [ENotifyDeviceKind.ApnsMac]: apnsTransport(apns) }),
  }
}

const redisOf = (url: string | undefined): Redis | null =>
  url === undefined || url === '' ? null : new Redis(url)

const versionOf = (env: Record<string, string | undefined>): string =>
  absent(env['ATLAS_APP_VERSION']) ?? 'trigger'

const flushQuietly = async (analytics: ProductAnalytics): Promise<void> => {
  try {
    await analytics.flush()
  } catch {
    return
  }
}

export const buildNotifyGraph = (
  env: Record<string, string | undefined> = process.env,
): NotifyGraph => {
  const redis = redisOf(env['REDIS_URL'])
  const { analytics } = serverObservability({ version: versionOf(env), env })
  const presenceOf = (hash: PresenceHash) => ({
    read: async (args: { userId: string; now: string }): Promise<NotifyPresence[]> =>
      readPresence({ redis: hash, userId: args.userId, now: args.now }),
  })

  return {
    session: {
      read: async (args) => {
        const row = await db.orm.v2.V2Session.select(
          'userId',
          'title',
          'readSeq',
          'nested',
          'spawnedBySessionId',
          'mainThreadId',
        ).first({ id: args.sessionId })
        return row === null ? null : row
      },
    },
    turns: {
      startedAfter: async (args) => {
        const rows = await db.orm.v2.V2Event.where((event) =>
          and(
            event.threadId.eq(args.threadId),
            event.type.eq('turn-started'),
            event.seq.gt(args.seq),
          ),
        )
          .limit(1)
          .all()
        return rows.length > 0
      },
    },
    sound: {
      claim: async (args) => {
        if (redis === null) return true
        const claimed = await redis.set(`notify:sound:${args.userId}`, '1', 'PX', 60_000, 'NX')
        return claimed === 'OK'
      },
    },
    devices: {
      listEnabled: async (args) => {
        const rows = await db.orm.v2.V2PushDevice.where({ userId: args.userId }).all()
        return rows
          .filter((row) => row.disabledAt === null)
          .map((row) => ({
            id: row.id,
            kind: notifyDeviceKindSchema.parse(row.kind),
            token: row.token,
            secret: row.secret,
          }))
      },
      touch: async (args) => {
        await db.orm.v2.V2PushDevice.where({ id: args.deviceId }).update({
          lastSeenAt: new Date(args.now),
        })
      },
      remove: async (args) => {
        await db.orm.v2.V2PushDevice.where({ id: args.deviceId }).delete()
      },
    },
    presence: redis === null ? { read: async () => [] } : presenceOf(redis),
    settings: {
      read: async (args) => {
        const rows = await db.orm.public.UserSetting.where({ userId: args.userId }).all()
        return new Map(rows.map((row) => [row.key, decodeSettingValue(row.value)]))
      },
    },
    analytics,
    transports: transportsOf(env),
    now: () => new Date().toISOString(),
    dispose: async () => {
      if (redis !== null) await redis.quit()
      await flushQuietly(analytics)
    },
  }
}

export const withNotifyGraph = async <T>(work: (graph: NotifyGraph) => Promise<T>): Promise<T> => {
  const graph = buildNotifyGraph()
  try {
    return await work(graph)
  } finally {
    await graph.dispose()
  }
}

export const deliverToKinds = async (args: {
  graph: NotifyGraph
  devices: readonly NotifyDevice[]
  notification: AtlasNotification
}): Promise<readonly NotifyResult[]> => {
  const kinds = [...new Set(args.devices.map((device) => device.kind))]
  const delivered = await Promise.all(
    kinds.map((kind) => {
      const transport = args.graph.transports[kind]
      const ofKind = args.devices.filter((device) => device.kind === kind)
      if (transport === undefined || ofKind.length === 0) return Promise.resolve([])
      return transport.deliver({ devices: ofKind, notification: args.notification })
    }),
  )
  return delivered.flat()
}

export const settleDevices = async (args: {
  graph: NotifyGraph
  results: readonly NotifyResult[]
  now: string
}): Promise<void> => {
  for (const result of args.results) {
    if (result.gone === true) await args.graph.devices.remove({ deviceId: result.deviceId })
    else if (result.sent)
      await args.graph.devices.touch({ deviceId: result.deviceId, now: args.now })
  }
}

export const countsOf = (results: readonly NotifyResult[]): { sent: number; gone: number } => ({
  sent: results.filter((result) => result.sent).length,
  gone: results.filter((result) => result.gone === true).length,
})
