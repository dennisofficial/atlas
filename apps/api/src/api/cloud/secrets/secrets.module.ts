import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { SecretsController } from './secrets.controller'
import { SecretsService } from './secrets.service'

@Module({
  imports: [SessionsModule],
  controllers: [SecretsController],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
