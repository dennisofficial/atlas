import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { PrSubscriptionLinks } from '../../../_core/ports/pr-subscription-links'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { HealthModule } from '../../platform/health/health.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubAppHookController } from './github-app-hook.controller'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubHookController } from './github-hook.controller'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { sweepSchedulerProviders } from './github-sweep-scheduler'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { prFrameBusProvider } from './github-pr-fanout.transport'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { wakeDebounceProvider } from './github-sandbox-wake-debounce'
import { sandboxWakeBootProvider } from './github-sandbox-wake-boot'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import { GithubPrSubscriptionLinks } from './github-pr-subscription-links'
import { GithubSubscriptionsRouter } from './github-subscriptions.router'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubUserReads } from './github-user-reads'
import { GithubModule } from './github.module'
import { GithubObservationStore } from './github-observation.store'

@Module({
  imports: [GithubModule, HealthModule, RedisModule, SessionsModule],
  controllers: [GithubHookController, GithubAppHookController],
  providers: [
    GithubSubscriptionsRouter,
    GithubPrStreamRouter,
    GithubSubscriptionsService,
    GithubPrSubscriptionLinks,
    { provide: PrSubscriptionLinks, useExisting: GithubPrSubscriptionLinks },
    GithubObservationStore,
    GithubHookLifecycleService,
    GithubPollSweeperService,
    ...sweepSchedulerProviders(),
    GithubDeliveryService,
    GithubPrDiscussionDeliveryService,
    GithubPrEventMailboxService,
    prFrameBusProvider,
    GithubPrFanoutService,
    GithubSandboxWakeService,
    GithubAppInstallationsService,
    GithubAppInstallNoticeService,
    sandboxWakeBootProvider,
    backgroundWorkProvider(),
    wakeDebounceProvider(),
    GithubUserReads,
  ],
})
export class GithubRealtimeModule {}
