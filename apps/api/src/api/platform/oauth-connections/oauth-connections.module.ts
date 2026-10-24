import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { OauthConnectionsRouter } from './oauth-connections.router'
import { OauthConnectionsService } from './oauth-connections.service'
import { OauthClock, OauthConnectionStore, OauthIssuer } from './oauth-connections.types'
import { HttpOauthIssuer } from './oauth-issuer'
import { SystemOauthClock } from './oauth-refresh-policy'
import { PrismaOauthConnectionStore } from './prisma-oauth-connection.store'

@Module({
  imports: [SessionsModule],
  providers: [
    OauthConnectionsService,
    OauthConnectionsRouter,
    { provide: OauthConnectionStore, useClass: PrismaOauthConnectionStore },
    { provide: OauthIssuer, useClass: HttpOauthIssuer },
    { provide: OauthClock, useClass: SystemOauthClock },
  ],
  exports: [OauthConnectionsService],
})
export class OauthConnectionsModule {}
