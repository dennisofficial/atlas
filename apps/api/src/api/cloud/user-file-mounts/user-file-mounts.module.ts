import { Module } from '@nestjs/common'
import { UserFileMountsRouter } from './user-file-mounts.router'
import { UserFileMountsService } from './user-file-mounts.service'

@Module({
  providers: [UserFileMountsRouter, UserFileMountsService],
})
export class UserFileMountsModule {}
