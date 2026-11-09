import { Injectable } from '@nestjs/common'
import { RedisService } from '../../../_lib/redis/redis.service'
import { formatPresence, isWatchingThread, parsePresenceHash } from './presence-entries'

export const PRESENCE_KEY_TTL_S = 600

export const presenceKey = (userId: string): string => `atlas:presence:${userId}`

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  async report(args: { userId: string; clientId: string; threadId: string | null }): Promise<void> {
    if (!this.redis.isConfigured()) return
    const key = presenceKey(args.userId)
    const client = this.redis.client()
    if (args.threadId === null) {
      await client.hdel(key, args.clientId)
      return
    }
    await client.hset(
      key,
      args.clientId,
      formatPresence({ threadId: args.threadId, at: Date.now() }),
    )
    await client.expire(key, PRESENCE_KEY_TTL_S)
  }

  async isWatching(args: { userId: string; threadId: string }): Promise<boolean> {
    if (!this.redis.isConfigured()) return false
    try {
      const entries = parsePresenceHash(await this.redis.client().hgetall(presenceKey(args.userId)))
      return isWatchingThread({ entries, threadId: args.threadId, now: Date.now() })
    } catch {
      return false
    }
  }
}
