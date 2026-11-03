import { Module } from '@nestjs/common'
import { NotificationsService } from './notifications.service'
import { PushDevicesRouter } from './push-devices.router'

@Module({
  providers: [NotificationsService, PushDevicesRouter],
  exports: [NotificationsService],
})
export class NotificationsModule {}
