import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { UserFilesRouter } from './user-files.router'
import { UserFilesService } from './user-files.service'

@Module({
  imports: [SessionsModule],
  providers: [UserFilesRouter, UserFilesService],
  exports: [UserFilesService],
})
export class UserFilesModule {}
