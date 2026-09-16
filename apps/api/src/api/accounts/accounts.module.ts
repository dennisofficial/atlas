import { Module } from '@nestjs/common'
import { AccountsController } from './accounts.controller'
import { AccountsService } from './accounts.service'
import { BrokerService } from './broker.service'

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, BrokerService],
})
export class AccountsModule {}
