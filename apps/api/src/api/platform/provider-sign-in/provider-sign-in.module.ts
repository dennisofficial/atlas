import { Module } from '@nestjs/common'
import { AccountsModule } from '../accounts/accounts.module'
import { OauthConnectionsModule } from '../oauth-connections/oauth-connections.module'
import { SessionsModule } from '../sessions/sessions.module'
import { GlobalProviderHttp, ProviderHttp } from './provider-http'
import { ProviderSignInRouter } from './provider-sign-in.router'
import { ProviderSignInService } from './provider-sign-in.service'

@Module({
  imports: [SessionsModule, AccountsModule, OauthConnectionsModule],
  providers: [
    ProviderSignInService,
    ProviderSignInRouter,
    { provide: ProviderHttp, useClass: GlobalProviderHttp },
  ],
})
export class ProviderSignInModule {}
