import {
  PRESENCE_TTL_MS,
  notifyPresenceOf,
  presenceIsFresh,
  type NotifyPresence,
} from '@dltech/atlas-core'

export const PRESENCE_TTL_S = PRESENCE_TTL_MS / 1000

export const presenceKeyOf = (userId: string): string => `atlas:v2:presence:${userId}`

export type PresenceHash = {
  hset(key: string, field: string, value: string): Promise<number>
  hdel(key: string, field: string): Promise<number>
  hgetall(key: string): Promise<Record<string, string>>
  expire(key: string, seconds: number): Promise<number>
}

export const writePresence = async (args: {
  redis: PresenceHash
  userId: string
  clientId: string
  presence: NotifyPresence
}): Promise<void> => {
  const key = presenceKeyOf(args.userId)
  if (!args.presence.foreground) {
    await args.redis.hdel(key, args.clientId)
    return
  }
  await args.redis.hset(key, args.clientId, JSON.stringify(args.presence))
  await args.redis.expire(key, PRESENCE_TTL_S)
}

export const readPresence = async (args: {
  redis: PresenceHash
  userId: string
  now: string
}): Promise<NotifyPresence[]> => {
  const fields = await args.redis.hgetall(presenceKeyOf(args.userId))
  return notifyPresenceOf({ fields }).filter((presence) =>
    presenceIsFresh({ at: presence.at, now: args.now }),
  )
}
