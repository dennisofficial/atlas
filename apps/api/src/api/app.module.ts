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
import { FactoryModule } from './factory/factory.module'
import { GithubModule } from './cloud/github/github.module'
import { GithubSandboxPrsModule } from './cloud/github/github-sandbox-prs.module'
import { GithubWebhooksModule } from './cloud/github/github-webhooks.module'
import { DrainStateService } from './platform/health/drain-state.service'
import { HealthController } from './platform/health/health.controller'
import { MigrationStateService } from './platform/health/migration-state.service'
import { McpServersModule } from './cloud/mcp-servers/mcp-servers.module'
import { SandboxesModule } from './platform/sandboxes/sandboxes.module'
import { SecretsModule } from './cloud/secrets/secrets.module'
import { SessionsModule } from './platform/sessions/sessions.module'
import { UserContextModule } from './cloud/user-context/user-context.module'

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
    ClientVersionModule,
    AuthModule,
    AccountsModule,
    SecretsModule,
    McpServersModule,
    GithubModule,
    SessionsModule,
    SandboxesModule,
    FactoryModule,
    GithubWebhooksModule,
    GithubSandboxPrsModule,
    UserContextModule,
  ],
  controllers: [HealthController],
  providers: [
    DrainStateService,
    MigrationStateService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClientVersionGuard },
  ],
})
export class AppModule {}
