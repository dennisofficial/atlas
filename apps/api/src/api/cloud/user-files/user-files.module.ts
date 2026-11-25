import { Module } from '@nestjs/common'
import { UserFilesRouter } from './user-files.router'
import { UserFilesService } from './user-files.service'

@Module({
  providers: [UserFilesRouter, UserFilesService],
  exports: [UserFilesService],
})
export class UserFilesModule {}
