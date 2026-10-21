import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { EnvModule } from '../_core/config/env/env.module'
import { EnvService } from '../_core/config/env/env.service'
import { envConfigValidation } from '../_core/config/env/validation'
import { CryptoModule } from '../_lib/crypto/crypto.module'
import { TriggerModule } from '../_lib/trigger/trigger.module'
import { ClientVersionGuard } from '../_module/client-version/client-version.guard'
import { ClientVersionModule } from '../_module/client-version/client-version.module'
import { AccountsModule } from './platform/accounts/accounts.module'
import { AuthModule } from './platform/auth/auth.module'
import { GithubModule } from './cloud/github/github.module'
import { GithubRealtimeModule } from './cloud/github/github-realtime.module'
import { sweepScheduleImports } from './cloud/github/github-sweep-scheduler'
import { HealthController } from './platform/health/health.controller'
import { HealthModule } from './platform/health/health.module'
import { MigrationStateService } from './platform/health/migration-state.service'
import { MemoriesModule } from './cloud/memories/memories.module'
import { McpServersModule } from './cloud/mcp-servers/mcp-servers.module'
import { OauthConnectionsModule } from './platform/oauth-connections/oauth-connections.module'
import { PodLeasesModule } from './platform/pod-leases/pod-leases.module'
import { ProjectsModule } from './cloud/projects/projects.module'
import { PublishedBundlesModule } from './cloud/published-bundles/published-bundles.module'
import { SandboxesModule } from './platform/sandboxes/sandboxes.module'
import { SandboxCredentialsModule } from './cloud/sandbox-credentials/sandbox-credentials.module'
import { SandboxProvisioningModule } from './cloud/sandbox-provisioning/sandbox-provisioning.module'
import { ScopedConfigModule } from './cloud/scoped-config/scoped-config.module'
import { SecretsModule } from './cloud/secrets/secrets.module'
import { SettingsModule } from './cloud/settings/settings.module'
import { SessionsModule } from './platform/sessions/sessions.module'
import { SshSigningKeyModule } from './cloud/ssh-signing-key/ssh-signing-key.module'
import { UserFilesModule } from './cloud/user-files/user-files.module'
import { WorkspacesModule } from './cloud/workspaces/workspaces.module'

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
    ...sweepScheduleImports(),
    CryptoModule,
    TriggerModule,
    HealthModule,
    ClientVersionModule,
    AuthModule,
    AccountsModule,
    OauthConnectionsModule,
    PodLeasesModule,
    SecretsModule,
    SettingsModule,
    ProjectsModule,
    UserFilesModule,
    McpServersModule,
    GithubModule,
    SshSigningKeyModule,
    MemoriesModule,
    PublishedBundlesModule,
    SessionsModule,
    SandboxesModule,
    GithubRealtimeModule,
    WorkspacesModule,
    ScopedConfigModule,
    SandboxCredentialsModule,
    SandboxProvisioningModule,
  ],
  controllers: [HealthController],
  providers: [
    MigrationStateService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ClientVersionGuard },
  ],
})
export class AppModule {}
