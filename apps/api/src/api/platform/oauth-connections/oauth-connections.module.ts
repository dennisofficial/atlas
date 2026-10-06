import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { OauthConnectionsController } from './oauth-connections.controller'
import { OauthConnectionsService } from './oauth-connections.service'
import { OauthClock, OauthConnectionStore, OauthIssuer } from './oauth-connections.types'
import { HttpOauthIssuer } from './oauth-issuer'
import { SystemOauthClock } from './oauth-refresh-policy'
import { PrismaOauthConnectionStore } from './prisma-oauth-connection.store'

@Module({
  imports: [SessionsModule],
  controllers: [OauthConnectionsController],
  providers: [
    OauthConnectionsService,
    { provide: OauthConnectionStore, useClass: PrismaOauthConnectionStore },
    { provide: OauthIssuer, useClass: HttpOauthIssuer },
    { provide: OauthClock, useClass: SystemOauthClock },
  ],
})
export class OauthConnectionsModule {}
