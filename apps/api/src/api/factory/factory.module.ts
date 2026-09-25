import { Module } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { SessionsModule } from '../platform/sessions/sessions.module'
import { FactoryConnectionsController } from './connections/connections.controller'
import { FactoryConnectionsService } from './connections/connections.service'
import { FactoryDeliveriesController } from './delivery/deliveries.controller'
import { DeliveriesService } from './delivery/deliveries.service'
import { FactoryDriveSweeperService } from './drives/drive-sweeper.service'
import { FactoryDrivesService } from './drives/drives.service'
import { GithubInstallController } from './github-install.controller'
import { GithubInstallService } from './github-install.service'
import { BotRelevanceClassifier } from './classifier/bot-relevance.classifier'
import { GithubWebhookController } from './github-webhook.controller'
import { GithubWebhookService } from './github-webhook.service'
import { LinearWebhookController } from './linear-webhook.controller'
import { LinearWebhookService } from './linear-webhook.service'
import { LinearInstallController } from './linear/linear-install.controller'
import { LinearInstallService } from './linear/linear-install.service'
import { LinearTokensService } from './linear/linear-tokens.service'
import { FactoryCredentialService } from './orchestrator/factory-credentials'
import { FactoryIdentityService } from './orchestrator/factory-identity'
import {
  createOrchestratorChannel,
  ORCHESTRATOR_CHANNEL,
} from './orchestrator/orchestrator-channel'
import { OrchestratorService } from './orchestrator/orchestrator.service'
import { WakeLockService } from './orchestrator/wake-lock'
import { WakeRecoveryService } from './orchestrator/wake-recovery'
import { OrgSettingsController } from './settings/org-settings.controller'
import { OrgSettingsService } from './settings/org-settings.service'
import { GithubAppService } from './reply/github-app.service'
import { GithubSurfaceService } from './reply/github-surface.service'
import { ReplyWatchService } from './reply-watch/reply-watch.service'
import { EFactorySurface } from './factory.types'
import { GithubStatusSignal } from './status-signal/github-status-signal'
import { LinearStatusSignal } from './status-signal/linear-status-signal'
import { STATUS_SIGNAL_ADAPTERS, type StatusSignalAdapters } from './status-signal/status-signal'
import { StatusSignalsService } from './status-signal/status-signals.service'
import { GuardedReplyService } from './reply/guarded-reply.service'
import { OrchestratorSandboxGuard } from './reply/orchestrator-sandbox.guard'
import { FactoryRepliesController } from './reply/replies.controller'
import { FactoryGitCredentialSource } from './stations/factory-git-credentials'
import { StationResultsService } from './stations/station-results.service'
import { StationTokensService } from './stations/station-tokens.service'
import { StationsService } from './stations/stations.service'
import { FactoryStationsController } from './stations/stations.controller'
import { FactoryToolsController } from './tools/tools.controller'
import { FactoryGithubToolsService } from './tools/tools-github.service'
import { FactoryToolsService } from './tools/tools.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsController } from './work-items.controller'
import { WorkItemsService } from './work-items.service'

@Module({
  imports: [SessionsModule],
  controllers: [
    GithubWebhookController,
    LinearWebhookController,
    LinearInstallController,
    FactoryRepliesController,
    FactoryStationsController,
    FactoryDeliveriesController,
    FactoryConnectionsController,
    WorkItemsController,
    GithubInstallController,
    OrgSettingsController,
    FactoryToolsController,
  ],
  providers: [
    WorkItemsService,
    FactoryConnectionsService,
    TranscriptService,
    GithubWebhookService,
    GithubInstallService,
    OrgSettingsService,
    LinearWebhookService,
    LinearInstallService,
    LinearTokensService,
    FactoryIdentityService,
    FactoryCredentialService,
    WakeLockService,
    WakeRecoveryService,
    OrchestratorService,
    GuardedReplyService,
    OrchestratorSandboxGuard,
    FactoryDrivesService,
    FactoryDriveSweeperService,
    StationsService,
    StationResultsService,
    StationTokensService,
    DeliveriesService,
    FactoryToolsService,
    FactoryGithubToolsService,
    FactoryGitCredentialSource,
    {
      provide: GithubAppService,
      useFactory: (env: EnvService) => new GithubAppService(env),
      inject: [EnvService],
    },
    {
      provide: GithubSurfaceService,
      useFactory: (env: EnvService) => new GithubSurfaceService(env),
      inject: [EnvService],
    },
    { provide: ORCHESTRATOR_CHANNEL, useFactory: () => createOrchestratorChannel() },
    GithubStatusSignal,
    LinearStatusSignal,
    StatusSignalsService,
    ReplyWatchService,
    BotRelevanceClassifier,
    {
      provide: STATUS_SIGNAL_ADAPTERS,
      useFactory: (github: GithubStatusSignal, linear: LinearStatusSignal): StatusSignalAdapters =>
        new Map<EFactorySurface, (typeof github) | (typeof linear)>([
          [EFactorySurface.GitHub, github],
          [EFactorySurface.Linear, linear],
        ]),
      inject: [GithubStatusSignal, LinearStatusSignal],
    },
  ],
  exports: [
    WorkItemsService,
    FactoryConnectionsService,
    TranscriptService,
    OrchestratorService,
    GithubWebhookService,
    LinearWebhookService,
    LinearTokensService,
  ],
})
export class FactoryModule {}
