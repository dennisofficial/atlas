import { Module } from '@nestjs/common'
import { RefreshLockModule } from '../../../_lib/refresh-lock/refresh-lock.module'
import { OauthConnectionsService } from './oauth-connections.service'
import { OauthClock, OauthConnectionStore, OauthIssuer } from './oauth-connections.types'
import { HttpOauthIssuer } from './oauth-issuer'
import { SystemOauthClock } from './oauth-refresh-policy'
import { PrismaOauthConnectionStore } from './prisma-oauth-connection.store'

@Module({
  imports: [RefreshLockModule],
  providers: [
    OauthConnectionsService,
    { provide: OauthConnectionStore, useClass: PrismaOauthConnectionStore },
    { provide: OauthIssuer, useClass: HttpOauthIssuer },
    { provide: OauthClock, useClass: SystemOauthClock },
  ],
  exports: [OauthConnectionsService],
})
export class OauthConnectionsModule {}
