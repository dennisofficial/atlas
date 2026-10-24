import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { AccountLeaseRouter } from './account-lease.router'
import { AccountsRouter } from './accounts.router'
import { AccountsService } from './accounts.service'

@Module({
  imports: [SessionsModule],
  providers: [AccountsService, AccountsRouter, AccountLeaseRouter],
  exports: [AccountsService],
})
export class AccountsModule {}
