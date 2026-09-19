import { Module } from '@nestjs/common'
import { SessionsModule } from '../sessions/sessions.module'
import { GithubWebhookController } from './github-webhook.controller'
import { GithubWebhookService } from './github-webhook.service'
import { FactoryIdentityService } from './orchestrator/factory-identity'
import {
  createOrchestratorChannel,
  ORCHESTRATOR_CHANNEL,
} from './orchestrator/orchestrator-channel'
import { OrchestratorService } from './orchestrator/orchestrator.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

@Module({
  imports: [SessionsModule],
  controllers: [GithubWebhookController],
  providers: [
    WorkItemsService,
    TranscriptService,
    GithubWebhookService,
    FactoryIdentityService,
    OrchestratorService,
    { provide: ORCHESTRATOR_CHANNEL, useFactory: () => createOrchestratorChannel() },
  ],
  exports: [WorkItemsService, TranscriptService, OrchestratorService],
})
export class FactoryModule {}
