import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { AccountsController } from './accounts.controller'
import { AccountsService } from './accounts.service'

@Module({
  imports: [SessionsModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
