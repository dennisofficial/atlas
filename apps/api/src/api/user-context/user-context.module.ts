import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { UserContextController } from './user-context.controller'
import { UserContextService } from './user-context.service'

@Module({
  imports: [SessionsModule],
  controllers: [UserContextController],
  providers: [UserContextService],
})
export class UserContextModule {}
