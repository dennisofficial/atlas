import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
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
import { MigrationStateService } from './health/migration-state.service'
import { McpServersModule } from './mcp-servers/mcp-servers.module'
import { SandboxesModule } from './sandboxes/sandboxes.module'
import { SecretsModule } from './secrets/secrets.module'
import { SessionsModule } from './sessions/sessions.module'

@Module({
  imports: [
    EnvModule.forRoot({
      envService: EnvService,
      validationSchema: envConfigValidation,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    CryptoModule,
    ClientVersionModule,
    AuthModule,
    AccountsModule,
    SecretsModule,
    McpServersModule,
    GithubModule,
    SessionsModule,
    SandboxesModule,
  ],
  controllers: [HealthController],
  providers: [
    MigrationStateService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClientVersionGuard },
  ],
})
export class AppModule {}
