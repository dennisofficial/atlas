import { Module } from '@nestjs/common'
import { FactoryModule } from '../factory/factory.module'
import { GithubPrWebhookController } from './github-webhook.controller'
import { GithubPrWebhookService } from './github-webhook.service'
import { GithubModule } from './github.module'

/**
 * The GitHub App's single webhook URL lands on this ingress, which imports FactoryModule, so it
 * cannot live in GithubModule without closing a module cycle
 * (Factory → Sessions → Sandboxes → Github → Factory).
 */
@Module({
  imports: [GithubModule, FactoryModule],
  controllers: [GithubPrWebhookController],
  providers: [GithubPrWebhookService],
})
export class GithubWebhooksModule {}
