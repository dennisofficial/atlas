import Redis from 'ioredis'
import { db } from '@dltech/atlas-db'
import { ENotifyDeviceKind } from '@dltech/atlas-notifications'
import { notifyDeviceKindSchema } from '@dltech/atlas-wire'
import {
  readPresence,
  webPushTransport,
  type PresenceHash,
} from '@dltech/atlas-notifications/server'
import type { NotifyPresence } from '@dltech/atlas-core'
import type { NotificationTransport, NotifyDevice, NotifyResult } from '@dltech/atlas-notifications'

export type NotifySessionRow = { userId: string; title: string | null; readSeq: number | null }

export type NotifyGraph = {
  session: { read(args: { sessionId: string }): Promise<NotifySessionRow | null> }
  devices: {
    listEnabled(args: { userId: string; kind: ENotifyDeviceKind }): Promise<NotifyDevice[]>
    touch(args: { deviceId: string; now: string }): Promise<void>
    remove(args: { deviceId: string }): Promise<void>
  }
  presence: { read(args: { userId: string; now: string }): Promise<NotifyPresence[]> }
  transport: NotificationTransport
  now(): string
  dispose(): Promise<void>
}

const vapidOf = (env: Record<string, string | undefined>) => {
  const publicKey = env['WEB_PUSH_PUBLIC_KEY']
  const privateKey = env['WEB_PUSH_PRIVATE_KEY']
  const subject = env['WEB_PUSH_SUBJECT']
  if (publicKey === undefined || privateKey === undefined || subject === undefined) {
    throw new Error(
      'WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT must be set in the worker tier; notifications cannot be signed without them',
    )
  }
  return { publicKey, privateKey, subject }
}

const redisOf = (url: string | undefined): Redis | null =>
  url === undefined || url === '' ? null : new Redis(url)

export const buildNotifyGraph = (
  env: Record<string, string | undefined> = process.env,
): NotifyGraph => {
  const redis = redisOf(env['REDIS_URL'])
  const presenceOf = (hash: PresenceHash) => ({
    read: async (args: { userId: string; now: string }): Promise<NotifyPresence[]> =>
      readPresence({ redis: hash, userId: args.userId, now: args.now }),
  })

  return {
    session: {
      read: async (args) => {
        const row = await db.orm.v2.V2Session.select('userId', 'title', 'readSeq').first({
          id: args.sessionId,
        })
        return row === null ? null : row
      },
    },
    devices: {
      listEnabled: async (args) => {
        const rows = await db.orm.v2.V2PushDevice.where({
          userId: args.userId,
          kind: args.kind,
        }).all()
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
    transport: webPushTransport({ vapid: vapidOf(env) }),
    now: () => new Date().toISOString(),
    dispose: async () => {
      if (redis !== null) await redis.quit()
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
