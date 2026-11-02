import { Injectable } from '@nestjs/common'
import { RedisService } from '../../../_lib/redis/redis.service'

const KEY_PREFIX = 'github-app-sync:'

@Injectable()
export class GithubAppSyncGate {
  private readonly memo = new Map<string, number>()

  constructor(private readonly redis: RedisService) {}

  async claim(args: { key: string; ttlMs: number }): Promise<boolean> {
    if (this.redis.isConfigured()) {
      const result = await this.redis
        .client()
        .set(`${KEY_PREFIX}${args.key}`, '1', 'PX', args.ttlMs, 'NX')
      return result === 'OK'
    }
    const until = this.memo.get(args.key)
    if (until !== undefined && until > Date.now()) return false
    this.memo.set(args.key, Date.now() + args.ttlMs)
    return true
  }

  async release(args: { key: string }): Promise<void> {
    this.memo.delete(args.key)
    if (this.redis.isConfigured()) await this.redis.client().del(`${KEY_PREFIX}${args.key}`)
  }
}
