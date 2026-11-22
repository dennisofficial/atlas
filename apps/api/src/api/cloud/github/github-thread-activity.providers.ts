import type { Provider } from '@nestjs/common'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubHeadReads } from './github-head-reads'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { GithubPrStore } from './github-pr-store'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { threadActivityAt } from './github-thread-activity'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

export const pollSweeperProvider: Provider = {
  provide: GithubPollSweeperService,
  inject: [
    GithubService,
    GithubUserReads,
    GithubHookLifecycleService,
    GithubRequestCoordinator,
    GithubHeadReads,
    GithubPrStore,
  ],
  useFactory: (
    github: GithubService,
    reads: GithubUserReads,
    hooks: GithubHookLifecycleService,
    coordinator: GithubRequestCoordinator,
    headReads: GithubHeadReads,
    store: GithubPrStore,
  ) =>
    new GithubPollSweeperService(
      github,
      reads,
      hooks,
      coordinator,
      headReads,
      store,
      threadActivityAt,
    ),
}

export const subscriptionsServiceProvider: Provider = {
  provide: GithubSubscriptionsService,
  inject: [
    GithubService,
    GithubUserReads,
    GithubHookLifecycleService,
    GithubAppInstallNoticeService,
    GithubRequestCoordinator,
    GithubAppInstallationsService,
    GithubPrStore,
  ],
  useFactory: (
    github: GithubService,
    reads: GithubUserReads,
    hooks: GithubHookLifecycleService,
    installNotice: GithubAppInstallNoticeService,
    coordinator: GithubRequestCoordinator,
    installations: GithubAppInstallationsService,
    store: GithubPrStore,
  ) =>
    new GithubSubscriptionsService(
      github,
      reads,
      hooks,
      installNotice,
      coordinator,
      installations,
      store,
      threadActivityAt,
    ),
}
