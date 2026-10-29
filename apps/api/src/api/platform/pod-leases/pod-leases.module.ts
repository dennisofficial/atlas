import { Module } from '@nestjs/common'
import { LocalPodCheckpointRouter } from './pod-checkpoint.router'
import { PodLeasesRouter } from './pod-leases.router'
import { PodLeasesService } from './pod-leases.service'

@Module({
  providers: [PodLeasesService, PodLeasesRouter, LocalPodCheckpointRouter],
})
export class PodLeasesModule {}
