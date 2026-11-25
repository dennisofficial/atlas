import { Inject, Injectable } from '@nestjs/common'
import type { EClientSurface, NotifyPresence } from '@dltech/atlas-core'
import { readPresence, writePresence, type PresenceHash } from '@dltech/atlas-notifications/server'
import { RedisService } from '../../../_lib/redis/redis.service'

export type PresenceRedis = {
  isConfigured(): boolean
  client(): PresenceHash
}

export type PresenceReport = {
  userId: string
  clientId: string
  surface: EClientSurface
  sessionId: string | null
  foreground: boolean
}

@Injectable()
export class PresenceRegistry {
  constructor(@Inject(RedisService) private readonly redis: PresenceRedis) {}

  async report(args: PresenceReport): Promise<void> {
    if (!this.redis.isConfigured()) return
    try {
      await writePresence({
        redis: this.redis.client(),
        userId: args.userId,
        clientId: args.clientId,
        presence: {
          surface: args.surface,
          sessionId: args.sessionId,
          foreground: args.foreground,
          at: new Date().toISOString(),
        },
      })
    } catch {
      return
    }
  }

  async read(args: { userId: string; now: string }): Promise<NotifyPresence[]> {
    if (!this.redis.isConfigured()) return []
    try {
      return await readPresence({ redis: this.redis.client(), userId: args.userId, now: args.now })
    } catch {
      return []
    }
  }
}
