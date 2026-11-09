import { Module } from '@nestjs/common'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { PresenceModule } from '../presence/presence.module'
import { NotificationsService } from './notifications.service'
import { PushDevicesRouter } from './push-devices.router'
import { PushLedger } from './push-ledger'

@Module({
  imports: [PresenceModule, RedisModule],
  providers: [NotificationsService, PushLedger, PushDevicesRouter],
  exports: [NotificationsService],
})
export class NotificationsModule {}
