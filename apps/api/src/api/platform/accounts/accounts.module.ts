import { Module } from '@nestjs/common'
import { SecretsModule } from '../../cloud/secrets/secrets.module'
import { SessionsModule } from '../sessions/sessions.module'
import { AccountsController } from './accounts.controller'
import { AccountsService } from './accounts.service'
import { BrokerService } from './broker.service'
import { SandboxBrokerController } from './sandbox-broker.controller'
import { SandboxBrokerService } from './sandbox-broker.service'

@Module({
  imports: [SessionsModule, SecretsModule],
  controllers: [AccountsController, SandboxBrokerController],
  providers: [AccountsService, BrokerService, SandboxBrokerService],
})
export class AccountsModule {}
