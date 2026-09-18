import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { AccountsController } from './accounts.controller'
import { AccountsService } from './accounts.service'
import { BrokerService } from './broker.service'

@Module({
  imports: [SessionsModule],
  controllers: [AccountsController],
  providers: [AccountsService, BrokerService],
})
export class AccountsModule {}
