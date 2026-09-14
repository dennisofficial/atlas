import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { EnvModule } from '@core/config/env/env.module'
import { EnvService } from '@core/config/env/env.service'
import { envConfigValidation } from '@core/config/env/validation'
import { CryptoModule } from '@lib/crypto/crypto.module'
import { AccountsModule } from './accounts/accounts.module'
import { AuthModule } from './auth/auth.module'
import { HealthController } from './health/health.controller'

@Module({
  imports: [
    EnvModule.forRoot({
      envService: EnvService,
      validationSchema: envConfigValidation,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CryptoModule,
    AuthModule,
    AccountsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
