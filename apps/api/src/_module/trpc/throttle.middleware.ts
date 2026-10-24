import { Inject, Injectable } from '@nestjs/common'
import { ThrottlerStorage } from '@nestjs/throttler'
import { TRPCError } from '@trpc/server'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { EnvService } from '../../_core/config/env/env.service'
import { isApiTrpcCtx } from './api-trpc-context'
import { metaOf } from './procedure-meta'

const DEFAULT_TTL_MS = 60_000
const THROTTLER_NAME = 'default'

@Injectable()
export class ThrottleMiddleware implements TRPCMiddleware {
  constructor(
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
    @Inject(EnvService) private readonly env: EnvService,
  ) {}

  async use({ ctx, path, meta, next }: MiddlewareOptions): MiddlewareResponse {
    const override = metaOf(meta).throttle
    if (override === false) return next()
    const { limit, ttlMs } = override ?? {
      limit: this.env.get('RATE_LIMIT_PER_MINUTE'),
      ttlMs: DEFAULT_TTL_MS,
    }
    const ip = isApiTrpcCtx(ctx) ? ctx.req.ip : undefined
    const record = await this.storage.increment(
      `trpc:${path}:${ip ?? 'unknown'}`,
      ttlMs,
      limit,
      ttlMs,
      THROTTLER_NAME,
    )
    if (record.isBlocked) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `rate limit exceeded, retry in ${record.timeToBlockExpire}s`,
      })
    }
    return next()
  }
}
