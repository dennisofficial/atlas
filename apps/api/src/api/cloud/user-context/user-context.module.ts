import { Module } from '@nestjs/common'
import { ContextArchiveModule } from '../context-archive/context-archive.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { UserContextController } from './user-context.controller'
import { UserContextService } from './user-context.service'

@Module({
  imports: [ContextArchiveModule, SessionsModule],
  controllers: [UserContextController],
  providers: [UserContextService],
})
export class UserContextModule {}
