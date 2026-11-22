import type { Provider } from '@nestjs/common'
import { GithubAppInstallNoticeService } from '@dltech/atlas-github'
import { GithubAppInstallationsService } from '@dltech/atlas-github'
import { GithubHeadReads } from '@dltech/atlas-github'
import { GithubHookLifecycleService } from '@dltech/atlas-github'
import { GithubPollSweeperService } from '@dltech/atlas-github'
import { GithubPrStore } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import { threadActivityAt } from './github-thread-activity'
import { GithubUserReads } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'

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
