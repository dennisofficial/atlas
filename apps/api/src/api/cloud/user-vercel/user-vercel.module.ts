import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { UserVercelRouter } from './user-vercel.router'
import { UserVercelService } from './user-vercel.service'
import { VercelPlanService } from './vercel-credential-plan'
import { VercelOauthCallbackController } from './vercel-oauth-callback.controller'
import { VERCEL_OAUTH_CALLBACK_PATH, VercelFetcher, VercelOauthConfig } from './vercel-oauth.types'
import { VercelTokenRefresher } from './vercel-token-refresher'

@Module({
  imports: [SessionsModule],
  controllers: [VercelOauthCallbackController],
  providers: [
    UserVercelRouter,
    UserVercelService,
    VercelPlanService,
    VercelTokenRefresher,
    VercelFetcher,
    {
      provide: VercelOauthConfig,
      inject: [EnvService],
      useFactory: (env: EnvService): VercelOauthConfig => ({
        redirectUri: `${env.get('BETTER_AUTH_URL').replace(/\/$/, '')}${VERCEL_OAUTH_CALLBACK_PATH}`,
        webOrigin: env.get('WEB_ORIGIN'),
      }),
    },
  ],
  exports: [VercelTokenRefresher, VercelPlanService, UserVercelService],
})
export class UserVercelModule {}
