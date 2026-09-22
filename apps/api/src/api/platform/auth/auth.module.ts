import { Module } from '@nestjs/common'
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth'
import { SessionModule } from '../../../_module/session/session.module'
import { auth } from './auth.server'
import { BetterAuthSessionVerifier } from './better-auth-session-verifier'

@Module({
  imports: [
    BetterAuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: true,
      disableTrustedOriginsCors: true,
    }),
    SessionModule.withVerifier(BetterAuthSessionVerifier),
  ],
})
export class AuthModule {}
