import { Module } from '@nestjs/common'
import { GithubWebhookController } from './github-webhook.controller'
import { GithubWebhookService } from './github-webhook.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

@Module({
  controllers: [GithubWebhookController],
  providers: [WorkItemsService, TranscriptService, GithubWebhookService],
  exports: [WorkItemsService, TranscriptService],
})
export class FactoryModule {}
