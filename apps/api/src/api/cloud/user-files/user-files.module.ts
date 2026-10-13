import { Module } from '@nestjs/common'
import { HealthModule } from '../../platform/health/health.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { UserFilesController } from './user-files.controller'
import { UserFilesFanoutService } from './user-files.fanout'
import { UserFilesService } from './user-files.service'

@Module({
  imports: [HealthModule, SessionsModule],
  controllers: [UserFilesController],
  providers: [UserFilesService, UserFilesFanoutService],
  exports: [UserFilesService],
})
export class UserFilesModule {}
