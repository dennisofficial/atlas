import { Module } from '@nestjs/common'
import { PodLeasesRouter } from './pod-leases.router'
import { PodLeasesService } from './pod-leases.service'

@Module({
  providers: [PodLeasesService, PodLeasesRouter],
})
export class PodLeasesModule {}
