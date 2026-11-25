import { Module } from '@nestjs/common'
import { SecretsRouter } from './secrets.router'
import { SecretsService } from './secrets.service'

@Module({
  providers: [SecretsRouter, SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
