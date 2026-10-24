import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { SecretsRouter } from './secrets.router'
import { SecretsService } from './secrets.service'

@Module({
  imports: [SessionsModule],
  providers: [SecretsRouter, SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
