import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { EnvModule } from '../_core/config/env/env.module'
import { EnvService } from '../_core/config/env/env.service'
import { envConfigValidation } from '../_core/config/env/validation'
import { CryptoModule } from '../_lib/crypto/crypto.module'
import { ClientVersionGuard } from '../_module/client-version/client-version.guard'
import { ClientVersionModule } from '../_module/client-version/client-version.module'
import { AccountsModule } from './accounts/accounts.module'
import { AuthModule } from './auth/auth.module'
import { GithubModule } from './github/github.module'
import { HealthController } from './health/health.controller'
import { McpServersModule } from './mcp-servers/mcp-servers.module'
import { SecretsModule } from './secrets/secrets.module'

@Module({
  imports: [
    EnvModule.forRoot({
      envService: EnvService,
      validationSchema: envConfigValidation,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CryptoModule,
    ClientVersionModule,
    AuthModule,
    AccountsModule,
    SecretsModule,
    McpServersModule,
    GithubModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClientVersionGuard },
  ],
})
export class AppModule {}
