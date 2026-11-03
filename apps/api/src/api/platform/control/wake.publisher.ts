import { Logger } from '@nestjs/common'
import { WAKE_CHANNEL } from '@dltech/atlas-protocol'
import { RedisService } from '../../../_lib/redis/redis.service'

export abstract class WakePublisher {
  abstract publish(args: { sessionId: string }): Promise<void>
}

export class DisabledWakePublisher extends WakePublisher {
  private readonly logger = new Logger(DisabledWakePublisher.name)
  private logged = false

  async publish(): Promise<void> {
    if (this.logged) return
    this.logged = true
    this.logger.warn('REDIS_URL is not set; wake notifications are disabled')
  }
}

export class RedisWakePublisher extends WakePublisher {
  constructor(private readonly redis: RedisService) {
    super()
  }

  async publish(args: { sessionId: string }): Promise<void> {
    await this.redis.client().publish(WAKE_CHANNEL, JSON.stringify({ sessionId: args.sessionId }))
  }
}
