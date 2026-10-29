import { Module } from '@nestjs/common'
import { createStandaloneTitler } from '@dltech/atlas-harness/titling'
import { AccountsModule } from '../../platform/accounts/accounts.module'
import { OauthConnectionsModule } from '../../platform/oauth-connections/oauth-connections.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { ThreadTitlingService, TITLER_FACTORY } from './thread-titling.service'

@Module({
  imports: [ScopedConfigModule, AccountsModule, OauthConnectionsModule, SessionsModule],
  providers: [ThreadTitlingService, { provide: TITLER_FACTORY, useValue: createStandaloneTitler }],
  exports: [ThreadTitlingService],
})
export class ThreadTitlingModule {}
