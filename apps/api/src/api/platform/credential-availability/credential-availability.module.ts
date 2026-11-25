import { Module } from '@nestjs/common'
import { CredentialAvailabilityRouter } from './credential-availability.router'
import { CredentialAvailabilityService } from './credential-availability.service'

@Module({
  providers: [CredentialAvailabilityService, CredentialAvailabilityRouter],
  exports: [CredentialAvailabilityService],
})
export class CredentialAvailabilityModule {}
