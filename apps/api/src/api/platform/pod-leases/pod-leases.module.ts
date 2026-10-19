import { Module } from '@nestjs/common'
import { PodLeasesController } from './pod-leases.controller'
import { PodLeasesService } from './pod-leases.service'

@Module({
  controllers: [PodLeasesController],
  providers: [PodLeasesService],
})
export class PodLeasesModule {}
