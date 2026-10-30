import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { HarnessSecretsRouter } from './harness-secrets.router'
import { HarnessSecretsService } from './harness-secrets.service'

@Module({
  imports: [SessionsModule],
  providers: [HarnessSecretsRouter, HarnessSecretsService],
  exports: [HarnessSecretsService],
})
export class HarnessSecretsModule {}
