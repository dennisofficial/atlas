import { Module } from '@nestjs/common'
import { HealthModule } from '../../platform/health/health.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubHookController } from './github-hook.controller'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrStreamController } from './github-pr-stream.controller'
import { GithubSubscriptionsController } from './github-subscriptions.controller'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubUserReads } from './github-user-reads'
import { GithubModule } from './github.module'

@Module({
  imports: [GithubModule, HealthModule, SessionsModule],
  controllers: [GithubSubscriptionsController, GithubPrStreamController, GithubHookController],
  providers: [
    GithubSubscriptionsService,
    GithubHookLifecycleService,
    GithubPollSweeperService,
    GithubDeliveryService,
    GithubPrFanoutService,
    GithubUserReads,
  ],
})
export class GithubRealtimeModule {}
