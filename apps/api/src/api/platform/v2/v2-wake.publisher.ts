import { Logger } from '@nestjs/common'
import { V2_WAKE_CHANNEL } from '@dltech/atlas-protocol'
import { RedisService } from '../../../_lib/redis/redis.service'

export abstract class V2WakePublisher {
  abstract publish(args: { sessionId: string }): Promise<void>
}

export class DisabledV2WakePublisher extends V2WakePublisher {
  private readonly logger = new Logger(DisabledV2WakePublisher.name)
  private logged = false

  async publish(): Promise<void> {
    if (this.logged) return
    this.logged = true
    this.logger.warn('REDIS_URL is not set; v2 wake notifications are disabled')
  }
}

export class RedisV2WakePublisher extends V2WakePublisher {
  constructor(private readonly redis: RedisService) {
    super()
  }

  async publish(args: { sessionId: string }): Promise<void> {
    await this.redis
      .client()
      .publish(V2_WAKE_CHANNEL, JSON.stringify({ sessionId: args.sessionId }))
  }
}
