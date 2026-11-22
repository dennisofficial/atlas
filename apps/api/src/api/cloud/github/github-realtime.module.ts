import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { PrSubscriptionLinks } from '../../../_core/ports/pr-subscription-links'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { HealthModule } from '../../platform/health/health.module'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubAppHookController } from './github-app-hook.controller'
import { GithubHookController } from './github-hook.controller'
import { sweepSchedulerProviders } from './github-sweep-scheduler'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { wakeDebounceProvider } from './github-sandbox-wake-debounce'
import { sandboxWakeBootProvider } from './github-sandbox-wake-boot'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import { GithubPrSubscriptionLinks } from './github-pr-subscription-links'
import { GithubSubscriptionsRouter } from './github-subscriptions.router'
import { GithubModule } from './github.module'
import {
  pollSweeperProvider,
  subscriptionsServiceProvider,
} from './github-thread-activity.providers'
import {
  mailboxProvider,
  outboxDispatcherProvider,
  prApplyWiringProvider,
  prStoreProvider,
} from './github-pr-apply.providers'
import {
  githubAppClientProvider,
  githubAppInstallationsProvider,
  githubAppInstallNoticeProvider,
  githubAppSyncGateProvider,
  githubAppSyncServiceProvider,
  githubDeliveryProvider,
  githubHeadReadsProvider,
  githubHookLifecycleProvider,
  githubHookSweepProvider,
  githubInstallationTokensProvider,
  githubPrDiscussionDeliveryProvider,
  githubPrFanoutProvider,
  githubUserReadsProvider,
  githubWebhookInboxProvider,
  prFrameBusProvider,
} from './github-realtime.providers'

@Module({
  imports: [GithubModule, HealthModule, RedisModule, SessionsModule],
  controllers: [GithubHookController, GithubAppHookController],
  providers: [
    GithubSubscriptionsRouter,
    GithubPrStreamRouter,
    subscriptionsServiceProvider,
    GithubPrSubscriptionLinks,
    { provide: PrSubscriptionLinks, useExisting: GithubPrSubscriptionLinks },
    githubHookLifecycleProvider,
    githubHeadReadsProvider,
    pollSweeperProvider,
    ...sweepSchedulerProviders(),
    githubDeliveryProvider,
    githubPrDiscussionDeliveryProvider,
    prApplyWiringProvider,
    mailboxProvider,
    outboxDispatcherProvider,
    prStoreProvider,
    githubWebhookInboxProvider,
    prFrameBusProvider,
    githubPrFanoutProvider,
    GithubSandboxWakeService,
    githubAppInstallationsProvider,
    githubAppClientProvider,
    githubInstallationTokensProvider,
    githubAppSyncGateProvider,
    githubAppSyncServiceProvider,
    githubHookSweepProvider,
    githubAppInstallNoticeProvider,
    sandboxWakeBootProvider,
    backgroundWorkProvider(),
    wakeDebounceProvider(),
    githubUserReadsProvider,
  ],
})
export class GithubRealtimeModule {}
