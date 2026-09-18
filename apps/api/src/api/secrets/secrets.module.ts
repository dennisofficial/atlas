import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { SecretsController } from './secrets.controller'
import { SecretsService } from './secrets.service'

@Module({
  imports: [SessionsModule],
  controllers: [SecretsController],
  providers: [SecretsService],
})
export class SecretsModule {}
