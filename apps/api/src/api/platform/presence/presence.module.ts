import { Module } from '@nestjs/common'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { PresenceRouter } from './presence.router'
import { PresenceService } from './presence.service'

@Module({
  imports: [RedisModule],
  providers: [PresenceService, PresenceRouter],
  exports: [PresenceService],
})
export class PresenceModule {}
