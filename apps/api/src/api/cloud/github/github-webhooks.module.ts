import { Module } from '@nestjs/common'
import { GithubPrWebhookController } from './github-webhook.controller'
import { GithubPrWebhookService } from './github-webhook.service'
import { GithubModule } from './github.module'

@Module({
  imports: [GithubModule],
  controllers: [GithubPrWebhookController],
  providers: [GithubPrWebhookService],
})
export class GithubWebhooksModule {}
