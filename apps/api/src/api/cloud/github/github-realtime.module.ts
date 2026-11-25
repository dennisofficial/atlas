import { Module } from '@nestjs/common'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { HealthModule } from '../../platform/health/health.module'
import { GithubAppHookController } from './github-app-hook.controller'
import { GithubHookController } from './github-hook.controller'
import { GithubSweepSchedulerService } from './github-sweep-scheduler'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import { GithubModule } from './github.module'
import { pollSweeperProvider, subscriptionsServiceProvider } from './github-sweep.providers'
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
  imports: [GithubModule, HealthModule, RedisModule],
  controllers: [GithubHookController, GithubAppHookController],
  providers: [
    GithubPrStreamRouter,
    subscriptionsServiceProvider,
    githubHookLifecycleProvider,
    githubHeadReadsProvider,
    pollSweeperProvider,
    GithubSweepSchedulerService,
    githubDeliveryProvider,
    githubPrDiscussionDeliveryProvider,
    prApplyWiringProvider,
    mailboxProvider,
    outboxDispatcherProvider,
    prStoreProvider,
    githubWebhookInboxProvider,
    prFrameBusProvider,
    githubPrFanoutProvider,
    githubAppInstallationsProvider,
    githubAppClientProvider,
    githubInstallationTokensProvider,
    githubAppSyncGateProvider,
    githubAppSyncServiceProvider,
    githubHookSweepProvider,
    githubAppInstallNoticeProvider,
    backgroundWorkProvider(),
    githubUserReadsProvider,
  ],
})
export class GithubRealtimeModule {}
