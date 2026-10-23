import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { AccountLeaseController } from './account-lease.controller'
import { AccountsController } from './accounts.controller'
import { AccountsService } from './accounts.service'

@Module({
  imports: [SessionsModule],
  controllers: [AccountsController, AccountLeaseController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
