import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { UserFilesController } from './user-files.controller'
import { UserFilesService } from './user-files.service'

@Module({
  imports: [SessionsModule],
  controllers: [UserFilesController],
  providers: [UserFilesService],
  exports: [UserFilesService],
})
export class UserFilesModule {}
