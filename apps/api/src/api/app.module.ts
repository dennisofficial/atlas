import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { TRPCModule } from 'nestjs-trpc'
import { EnvModule } from '../_core/config/env/env.module'
import { EnvService } from '../_core/config/env/env.service'
import { envConfigValidation } from '../_core/config/env/validation'
import { CryptoModule } from '../_lib/crypto/crypto.module'
import { TriggerModule } from '../_lib/trigger/trigger.module'
import { ClientVersionGuard } from '../_module/client-version/client-version.guard'
import { ClientVersionModule } from '../_module/client-version/client-version.module'
import { ApiTrpcContext } from '../_module/trpc/api-trpc-context'
import { ApiTrpcModule } from '../_module/trpc/api-trpc.module'
import { HttpErrorMiddleware } from '../_module/trpc/http-error.middleware'
import { ThrottleMiddleware } from '../_module/trpc/throttle.middleware'
import { apiErrorFormatter } from '../_module/trpc/trpc-error-formatter'
import { AccountsModule } from './platform/accounts/accounts.module'
import { AuthModule } from './platform/auth/auth.module'
import { GithubModule } from './cloud/github/github.module'
import { GithubRealtimeModule } from './cloud/github/github-realtime.module'
import { sweepScheduleImports } from './cloud/github/github-sweep-scheduler'
import { HealthController } from './platform/health/health.controller'
import { HealthModule } from './platform/health/health.module'
import { MigrationStateService } from './platform/health/migration-state.service'
import { MemoriesModule } from './cloud/memories/memories.module'
import { McpOauthModule } from './cloud/mcp-oauth/mcp-oauth.module'
import { McpServersModule } from './cloud/mcp-servers/mcp-servers.module'
import { ModelsModule } from './platform/models/models.module'
import { OauthConnectionsModule } from './platform/oauth-connections/oauth-connections.module'
import { ProviderSignInModule } from './platform/provider-sign-in/provider-sign-in.module'
import { DesktopAuthModule } from './platform/desktop-auth/desktop-auth.module'
import { PodLeasesModule } from './platform/pod-leases/pod-leases.module'
import { ProjectsModule } from './cloud/projects/projects.module'
import { PublishedBundlesModule } from './cloud/published-bundles/published-bundles.module'
import { ComposerUploadsModule } from './cloud/composer-uploads/composer-uploads.module'
import { SandboxesModule } from './platform/sandboxes/sandboxes.module'
import { SandboxCredentialsModule } from './cloud/sandbox-credentials/sandbox-credentials.module'
import { SandboxProvisioningModule } from './cloud/sandbox-provisioning/sandbox-provisioning.module'
import { ScopedConfigModule } from './cloud/scoped-config/scoped-config.module'
import { SecretsModule } from './cloud/secrets/secrets.module'
import { HarnessSecretsModule } from './cloud/harness-secrets/harness-secrets.module'
import { SettingsModule } from './cloud/settings/settings.module'
import { SessionsModule } from './platform/sessions/sessions.module'
import { SshSigningKeyModule } from './cloud/ssh-signing-key/ssh-signing-key.module'
import { SkillCatalogueModule } from './cloud/skill-catalogue/skill-catalogue.module'
import { UserFilesModule } from './cloud/user-files/user-files.module'
import { UserVercelModule } from './cloud/user-vercel/user-vercel.module'

@Module({
  imports: [
    EnvModule.forRoot({
      envService: EnvService,
      validationSchema: envConfigValidation,
    }),
    ThrottlerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => [{ ttl: 60_000, limit: env.get('RATE_LIMIT_PER_MINUTE') }],
    }),
    ...sweepScheduleImports(),
    CryptoModule,
    TriggerModule,
    HealthModule,
    ClientVersionModule,
    ApiTrpcModule,
    TRPCModule.forRoot({
      basePath: '/v1/trpc',
      context: ApiTrpcContext,
      errorFormatter: apiErrorFormatter,
      globalMiddlewares: [HttpErrorMiddleware, ThrottleMiddleware],
    }),
    AuthModule,
    DesktopAuthModule,
    AccountsModule,
    OauthConnectionsModule,
    ProviderSignInModule,
    ModelsModule,
    PodLeasesModule,
    SecretsModule,
    HarnessSecretsModule,
    SettingsModule,
    ProjectsModule,
    UserFilesModule,
    SkillCatalogueModule,
    UserVercelModule,
    McpServersModule,
    McpOauthModule,
    GithubModule,
    SshSigningKeyModule,
    MemoriesModule,
    PublishedBundlesModule,
    ComposerUploadsModule,
    SessionsModule,
    SandboxesModule,
    GithubRealtimeModule,
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
