import { Module } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { SessionsModule } from '../sessions/sessions.module'
import { GithubWebhookController } from './github-webhook.controller'
import { GithubWebhookService } from './github-webhook.service'
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
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

@Module({
  imports: [SessionsModule],
  controllers: [GithubWebhookController, FactoryRepliesController],
  providers: [
    WorkItemsService,
    TranscriptService,
    GithubWebhookService,
    FactoryIdentityService,
    FactoryCredentialService,
    OrchestratorService,
    GuardedReplyService,
    OrchestratorSandboxGuard,
    {
      provide: GithubAppService,
      useFactory: (env: EnvService) => new GithubAppService(env),
      inject: [EnvService],
    },
    { provide: ORCHESTRATOR_CHANNEL, useFactory: () => createOrchestratorChannel() },
  ],
  exports: [WorkItemsService, TranscriptService, OrchestratorService],
})
export class FactoryModule {}
