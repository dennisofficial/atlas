import { Module } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { SessionsModule } from '../platform/sessions/sessions.module'
import { FactoryConnectionsService } from './connections/connections.service'
import { FactoryDeliveriesController } from './delivery/deliveries.controller'
import { DeliveriesService } from './delivery/deliveries.service'
import { FactoryDriveSweeperService } from './drives/drive-sweeper.service'
import { FactoryDrivesService } from './drives/drives.service'
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
import { GithubAppService } from './reply/github-app.service'
import { GuardedReplyService } from './reply/guarded-reply.service'
import { OrchestratorSandboxGuard } from './reply/orchestrator-sandbox.guard'
import { FactoryRepliesController } from './reply/replies.controller'
import { FactoryGitCredentialSource } from './stations/factory-git-credentials'
import { StationResultsService } from './stations/station-results.service'
import { StationTokensService } from './stations/station-tokens.service'
import { StationsService } from './stations/stations.service'
import { FactoryStationsController } from './stations/stations.controller'
import { TranscriptService } from './transcript.service'
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
  ],
  providers: [
    WorkItemsService,
    FactoryConnectionsService,
    TranscriptService,
    GithubWebhookService,
    LinearWebhookService,
    LinearInstallService,
    LinearTokensService,
    FactoryIdentityService,
    FactoryCredentialService,
    OrchestratorService,
    GuardedReplyService,
    OrchestratorSandboxGuard,
    FactoryDrivesService,
    FactoryDriveSweeperService,
    StationsService,
    StationResultsService,
    StationTokensService,
    DeliveriesService,
    FactoryGitCredentialSource,
    {
      provide: GithubAppService,
      useFactory: (env: EnvService) => new GithubAppService(env),
      inject: [EnvService],
    },
    { provide: ORCHESTRATOR_CHANNEL, useFactory: () => createOrchestratorChannel() },
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
