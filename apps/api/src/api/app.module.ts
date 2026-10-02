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
import { AccountsModule } from './platform/accounts/accounts.module'
import { AuthModule } from './platform/auth/auth.module'
import { GithubModule } from './cloud/github/github.module'
import { GithubRealtimeModule } from './cloud/github/github-realtime.module'
import { HealthController } from './platform/health/health.controller'
import { HealthModule } from './platform/health/health.module'
import { MigrationStateService } from './platform/health/migration-state.service'
import { McpServersModule } from './cloud/mcp-servers/mcp-servers.module'
import { SandboxesModule } from './platform/sandboxes/sandboxes.module'
import { SecretsModule } from './cloud/secrets/secrets.module'
import { SettingsModule } from './cloud/settings/settings.module'
import { SessionsModule } from './platform/sessions/sessions.module'

@Module({
  imports: [
    EnvModule.forRoot({
      envService: EnvService,
      validationSchema: envConfigValidation,
    }),
    ThrottlerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => [
        { ttl: 60_000, limit: env.get('RATE_LIMIT_PER_MINUTE') },
      ],
    }),
    ScheduleModule.forRoot(),
    CryptoModule,
    HealthModule,
    ClientVersionModule,
    AuthModule,
    AccountsModule,
    SecretsModule,
    SettingsModule,
    McpServersModule,
    GithubModule,
    SessionsModule,
    SandboxesModule,
    GithubRealtimeModule,
  ],
  controllers: [HealthController],
  providers: [
    MigrationStateService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClientVersionGuard },
  ],
})
export class AppModule {}
