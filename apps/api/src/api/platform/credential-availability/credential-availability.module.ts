import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { CredentialAvailabilityRouter } from './credential-availability.router'
import { CredentialAvailabilityService } from './credential-availability.service'

@Module({
  imports: [SessionsModule],
  providers: [CredentialAvailabilityService, CredentialAvailabilityRouter],
  exports: [CredentialAvailabilityService],
})
export class CredentialAvailabilityModule {}
