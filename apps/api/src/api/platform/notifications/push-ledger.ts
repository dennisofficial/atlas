import { Injectable } from '@nestjs/common'
import { RedisService } from '../../../_lib/redis/redis.service'

export const DISMISS_WINDOW_MS = 60 * 60 * 1000
export const PUSH_LEDGER_TTL_S = 2 * 60 * 60

export const pushLedgerKey = (userId: string): string => `atlas:push-sent:${userId}`

@Injectable()
export class PushLedger {
  constructor(private readonly redis: RedisService) {}

  async noteSent(args: { userId: string; threadId: string }): Promise<void> {
    if (!this.redis.isConfigured()) return
    try {
      const key = pushLedgerKey(args.userId)
      await this.redis.client().hset(key, args.threadId, String(Date.now()))
      await this.redis.client().expire(key, PUSH_LEDGER_TTL_S)
    } catch {
      return
    }
  }

  async takeSent(args: { userId: string; threadId: string }): Promise<number | undefined> {
    if (!this.redis.isConfigured()) return undefined
    try {
      const key = pushLedgerKey(args.userId)
      const raw = await this.redis.client().hget(key, args.threadId)
      if (raw === null) return undefined
      await this.redis.client().hdel(key, args.threadId)
      const at = Number(raw)
      if (!Number.isFinite(at)) return undefined
      return Date.now() - at <= DISMISS_WINDOW_MS ? at : undefined
    } catch {
      return undefined
    }
  }
}
