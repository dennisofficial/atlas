import { Module } from '@nestjs/common'
import { HarnessSecretsRouter } from './harness-secrets.router'
import { HarnessSecretsService } from './harness-secrets.service'

@Module({
  providers: [HarnessSecretsRouter, HarnessSecretsService],
  exports: [HarnessSecretsService],
})
export class HarnessSecretsModule {}
